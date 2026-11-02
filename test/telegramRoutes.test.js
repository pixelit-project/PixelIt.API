const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.ADMIN_ORIGIN = 'https://example.test';
process.env.API_ADMIN_LOGIN_LIMIT_MAX = '100';
const calls = [];
const app = express();
app.use(express.json());
require('../routes/moderation')(app, { isModerator: async () => true, rememberIdentity: async () => {} }, {}, {}, {
    configured: true, enabled: true, ownerId: '1',
    authorize: (state) => 'https://github.com/?state=' + state,
    identify: async () => ({ id: '2', login: 'mod' }),
}, {
    enabled: true,
    authorized: (secret) => secret === 'webhook-secret',
    status: async (id) => { calls.push(['status', id]); return { available: true, connected: false }; },
    link: async (id) => { calls.push(['link', id]); return { url: 'https://t.me/test?start=secret' }; },
    disconnect: async (id) => { calls.push(['disconnect', id]); },
    update: async (body) => {
        calls.push(['update', body]);
        return body.update_id === 2 ? { method: 'sendMessage', chat_id: '456', text: 'Telegram ist verbunden.' } : undefined;
    },
});
const server = app.listen(0, '127.0.0.1');
after(() => new Promise((resolve) => server.close(resolve)));
async function request(path, body, headers = {}) {
    if (!server.listening) {
        await new Promise((resolve) => server.once('listening', resolve));
    }
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
    });
}
test('Telegram settings require a session, bind to its identity and enforce Origin; webhook requires its secret', async () => {
    assert.equal((await request('/api/admin/telegram')).status, 401);
    assert.equal((await request('/api/telegram/webhook', {})).status, 403);
    assert.equal(calls.length, 0);
    const webhook = await request('/api/telegram/webhook', { update_id: 1 }, { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' });
    assert.equal(webhook.status, 204);
    assert.deepEqual(calls.pop(), ['update', { update_id: 1 }]);
    const confirmation = await request('/api/telegram/webhook', { update_id: 2 }, { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' });
    assert.equal(confirmation.status, 200);
    assert.deepEqual(await confirmation.json(), { method: 'sendMessage', chat_id: '456', text: 'Telegram ist verbunden.' });
    calls.pop();
    const start = await request('/api/admin/github/login');
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const login = await request(`/api/admin/github/callback?state=${state}&code=code`, undefined, {
        Cookie: start.headers.get('set-cookie').split(';')[0],
    });
    const session = login.headers.getSetCookie().find((value) => value.startsWith('__Host-pixelit_admin='));
    const headers = { Cookie: session.split(';')[0], Origin: 'https://example.test' };
    assert.equal((await request('/api/admin/telegram', undefined, headers)).status, 200);
    assert.deepEqual(calls.pop(), ['status', '2']);
    assert.equal((await request('/api/admin/telegram/link', {}, { ...headers, Origin: 'https://evil.test' })).status, 403);
    assert.equal((await request('/api/admin/telegram/link', { githubId: '1' }, headers)).status, 200);
    assert.deepEqual(calls.pop(), ['link', '2']);
    assert.equal((await request('/api/admin/telegram/disconnect', { githubId: '1' }, headers)).status, 204);
    assert.deepEqual(calls.pop(), ['disconnect', '2']);
});
