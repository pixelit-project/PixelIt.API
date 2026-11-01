const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const events = [];
const loggerPath = require.resolve('../libs/logger');
require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: Object.fromEntries(
        ['info', 'warn', 'error'].map((level) => [
            level,
            (message, properties) => events.push({ level, message, properties }),
        ])
    ),
};
process.env.ADMIN_PASSWORD = 'test-admin-password-123';
process.env.ADMIN_ORIGIN = 'https://admin.example.test';
process.env.API_GLOBAL_LIMIT_EXCLUDE = '127.0.0.1';
for (const name of ['REPORT', 'ADMIN_LOGIN', 'ADMIN_READ', 'ADMIN_ACTION']) {
    process.env[`API_${name}_LIMIT_MAX`] = '2';
}
const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json());
app.use('/api', require('../libs/rateLimit').apiLimiter);
let decisions = 0;
const sensitiveError = new Error('secret-password secret-report SQL values');
sensitiveError.code = 'ER_TEST_FAILURE';
require('../routes/moderation')(
    app,
    {
        report: async (id) => {
            if (id === 999) throw sensitiveError;
            return id !== 404;
        },
        list: async () => [],
        preview: async () => ({ sizeX: 1, sizeY: 1, pixels: '[0]' }),
        decide: async () => {
            decisions++;
            return true;
        },
    },
    { invalidateBitmaps() {} }
);
let forwardedError;
app.use((error, req, res, next) => {
    forwardedError = error;
    res.sendStatus(500);
});
const server = app.listen(0, '127.0.0.1');
after(() => new Promise((resolve) => server.close(resolve)));

async function request(path, body, { ip, cookie } = {}) {
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'https://admin.example.test',
            ...(ip ? { 'X-Forwarded-For': ip } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}
async function login(ip) {
    const response = await request('/api/admin/login', { password: process.env.ADMIN_PASSWORD }, { ip });
    assert.equal(response.status, 204);
    return response.headers.get('set-cookie').split(';')[0];
}

test('new limits still apply when the global limiter exempts the client IP', async () => {
    assert.equal((await request('/api/reports', { iconId: 1, reason: 'test' })).status, 202);
    assert.equal((await request('/api/reports', { iconId: 1, reason: 'test' })).status, 202);
    assert.equal((await request('/api/reports', { iconId: 1, reason: 'test' })).status, 429);
});
test('failed admin logins are limited before a session can be created', async () => {
    const options = { ip: '192.0.2.10' };
    assert.equal((await request('/api/admin/login', { password: 'wrong' }, options)).status, 401);
    assert.equal((await request('/api/admin/login', { password: 'wrong' }, options)).status, 401);
    assert.equal((await request('/api/admin/login', { password: process.env.ADMIN_PASSWORD }, options)).status, 429);
});
test('admin reads share a limit; moderation writes use an independent limit', async () => {
    const ip = '192.0.2.20';
    const cookie = await login(ip);
    const options = { ip, cookie };
    assert.equal((await request('/api/admin/reports', undefined, options)).status, 200);
    assert.equal((await request('/api/admin/icons/1', undefined, options)).status, 200);
    assert.equal((await request('/api/admin/reports', undefined, options)).status, 429);
    assert.equal((await request('/api/admin/reports/1/approve', {}, options)).status, 204);
    assert.equal((await request('/api/admin/reports/2/reject', {}, options)).status, 204);
    assert.equal((await request('/api/admin/reports/3/approve', {}, options)).status, 429);
    assert.equal(decisions, 2);
});
test('audit logs include security and decision events, but no credentials or request text', async () => {
    assert.equal(
        (await request('/api/reports', { iconId: 999, reason: 'secret-report' }, { ip: '192.0.2.30' })).status,
        500
    );
    assert.equal(forwardedError.message, 'CreateReport failed');
    const text = JSON.stringify(events);
    for (const event of ['authentication failed', 'RateLimit reached', 'committed', 'ER_TEST_FAILURE']) {
        assert.ok(text.includes(event), `missing event: ${event}`);
    }
    assert.ok(!text.includes(process.env.ADMIN_PASSWORD));
    assert.ok(!text.includes('secret-report'));
    assert.ok(!text.includes('secret-password'));
    assert.ok(!text.includes('__Host-pixelit_admin='));
    assert.ok(events.some((event) => event.properties?.reportId === 1 && event.properties?.action === 'approve'));
});
