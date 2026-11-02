const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
process.env.ADMIN_PASSWORD = 'long-test-password';
delete process.env.ADMIN_PASSWORD_HASH;
process.env.ADMIN_ORIGIN = 'https://example.test';
const app = express();
app.use(express.json());
let reports = 0,
    decisions = 0,
    invalidations = 0;
require('../routes/moderation')(
    app,
    {
        report: async () => {
            reports++;
            return true;
        },
        list: async () => [{ id: 1, reason: 'test' }],
        decide: async (id, action) => {
            decisions++;
            assert.equal(action, 'approve');
            return true;
        },
    },
    {
        invalidateBitmaps() {
            invalidations++;
        },
    }
);
const server = app.listen(0, '127.0.0.1');
after(() => new Promise((resolve) => server.close(resolve)));
async function req(path, body, headers = {}) {
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    return fetch('http://127.0.0.1:' + server.address().port + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
    });
}
test('admin session, CSRF, logout, validation and public reports', async () => {
    const publicPage = await req('/admin/');
    assert.equal(publicPage.status, 200);
    const loginHtml = await publicPage.text();
    assert.match(loginHtml, /PixelIt Admin/);
    assert.match(loginHtml, /lang="en"/);
    assert.match(loginHtml, />Password</);
    assert.doesNotMatch(await (await req('/admin/')).text(), /statistics-tab|Icon reports|telemetry-/);
    assert.equal((await req('/admin/app.js')).status, 401);
    assert.equal((await req('/admin/login.js')).status, 200);
    assert.equal((await req('/api/admin/reports')).status, 401);
    assert.equal((await req('/api/admin/login', { password: 'long-test-password' })).status, 403);
    const origin = { Origin: 'https://example.test' };
    assert.equal((await req('/api/admin/login', { password: 'wrong' }, origin)).status, 401);
    const login = await req('/api/admin/login', { password: 'long-test-password' }, origin);
    assert.equal(login.status, 204);
    const set = login.headers.get('set-cookie');
    assert.match(set, /HttpOnly; Secure; SameSite=Strict/);
    const headers = { ...origin, Cookie: set.split(';')[0] };
    const dashboardHtml = await (await req('/admin/', undefined, headers)).text();
    assert.match(dashboardHtml, /statistics-tab/);
    assert.match(dashboardHtml, /lang="en"/);
    assert.match(dashboardHtml, /Icon reports/);
    assert.equal((await req('/admin/app.js', undefined, headers)).status, 200);
    assert.equal((await req('/api/admin/reports', undefined, headers)).status, 200);
    assert.equal(
        (await req('/api/admin/reports/1/approve', {}, { Cookie: headers.Cookie, Origin: 'https://evil.test' })).status,
        403
    );
    assert.equal(decisions, 0);
    assert.equal((await req('/api/admin/reports/1/__proto__', {}, headers)).status, 400);
    assert.equal((await req('/api/admin/reports/1/approve', {}, headers)).status, 204);
    assert.equal(decisions, 1);
    assert.equal(invalidations, 1);
    assert.equal((await req('/api/admin/logout', {}, headers)).status, 204);
    assert.equal((await req('/api/admin/reports', undefined, headers)).status, 401);
    assert.equal((await req('/admin/app.js', undefined, headers)).status, 401);
    assert.doesNotMatch(await (await req('/admin/', undefined, headers)).text(), /statistics-tab/);
    assert.equal((await req('/api/reports', { iconId: 1, reason: '  ' })).status, 400);
    assert.equal((await req('/api/reports', { iconId: 1, reason: 'Duplicate icon' })).status, 202);
    assert.equal(reports, 1);
    assert.equal((await req('/admin/')).status, 200);
});
test('public report rate limit is separate from admin sessions', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await req('/api/reports', { iconId: 1, reason: 'test' })).status, 202);
    assert.equal((await req('/api/reports', { iconId: 1, reason: 'test' })).status, 429);
});
