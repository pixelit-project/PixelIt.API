const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const loggerPath = require.resolve('../libs/logger');
require.cache[loggerPath] = { loaded: true, exports: { info() {}, warn() {}, error() {} } };
process.env.ADMIN_PASSWORD = 'admin-statistics-password';
process.env.ADMIN_ORIGIN = 'https://admin.example.test';
process.env.TELEMETRY_USER_CHECK = 'true';
process.env.API_ADMIN_READ_LIMIT_MAX = '2';
const app = express();
app.use(express.json());
let loads = 0;
require('../routes/moderation')(
    app,
    {},
    {
        async getOrSet(key, load, lifetime) {
            assert.equal(key, 'AdminStatistics');
            assert.equal(lifetime, 60);
            return load();
        },
    },
    {
        async getAdminStatistics() {
            loads++;
            return { total: 3, active30d: 2, versions: [], hardware: [], matrices: [] };
        },
    }
);
const server = app.listen(0, '127.0.0.1');
after(() => new Promise((resolve) => server.close(resolve)));

async function request(path, body, cookie) {
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'https://admin.example.test',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

test('admin statistics require a session, use bounded caching and the shared admin read limit', async () => {
    assert.equal((await request('/api/admin/statistics')).status, 401);
    assert.equal(loads, 0);
    const login = await request('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    assert.equal(login.status, 204);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const statistics = await request('/api/admin/statistics', undefined, cookie);
    assert.equal(statistics.status, 200);
    assert.equal((await statistics.json()).active30d, 2);
    assert.equal((await request('/api/admin/statistics', undefined, cookie)).status, 200);
    assert.equal((await request('/api/admin/statistics', undefined, cookie)).status, 429);
    assert.equal(loads, 2);
});
