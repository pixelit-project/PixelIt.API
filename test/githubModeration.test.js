const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.ADMIN_ORIGIN = 'https://example.test';
process.env.API_ADMIN_LOGIN_LIMIT_MAX = '1000';
const members = new Set();
let identity = { id: '1', login: 'owner' };
let actor;
let identificationCalls = 0;
let lookupCalls = 0;
let lastMembership;
const app = express();
app.use(express.json());
require('../routes/moderation')(app, {
    rememberIdentity: async () => {},
    listModerationAudit: async () => [{ id: 9, action: 'approve', actor: 'github:2' }],
    listAdminAudit: async () => [{ id: 8, action: 'moderator_added' }],
    isModerator: async (id) => members.has(id),
    listModerators: async () => [...members].map((github_id) => ({ github_id })),
    setModerator: async (id, enabled, actor, login) => {
        lastMembership = { id, enabled, actor, login };
        if (enabled) {
            members.add(id);
        } else {
            members.delete(id);
        }
        return true;
    },
    decide: async (id, action, value) => {
        actor = value;
        return true;
    },
    list: async () => [],
}, { invalidateBitmaps() {} }, {}, {
    configured: true, enabled: true, ownerId: '1',
    lookupUser: async (login) => {
        lookupCalls++;
        if (login === 'missing') { return null; }
        if (login === 'failure') { throw new Error('upstream failure'); }
        return login === 'owner' ? { id: '1', login } : { id: '2', login: 'moderator' };
    },
    authorize: (state, challenge) => `https://github.com/login/oauth/authorize?state=${state}&code_challenge=${challenge}`,
    identify: async (code, verifier) => {
        identificationCalls++;
        assert.ok(verifier.length >= 43);
        if (code === 'failure') {
            throw new Error('upstream secret must not escape');
        }
        return identity;
    },
});
app.use((error, req, res, next) => res.status(500).send(error.message));
const server = app.listen(0, '127.0.0.1');
after(() => new Promise((resolve) => server.close(resolve)));
async function request(path, body, cookie, origin = 'https://example.test') {
    if (!server.listening) {
        await new Promise((resolve) => server.once('listening', resolve));
    }
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
    });
}
async function startLogin() {
    const response = await request('/api/admin/github/login');
    assert.equal(response.status, 302);
    const url = new URL(response.headers.get('location'));
    assert.equal(url.searchParams.get('code_challenge').length, 43);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
    return { state: url.searchParams.get('state'), cookie };
}
async function signIn() {
    const { state, cookie } = await startLogin();
    return request(`/api/admin/github/callback?state=${state}&code=valid`, undefined, cookie);
}
function sessionCookie(response) {
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-pixelit_admin='));
    return cookie.split(';')[0];
}
test('GitHub state binding, role enforcement, membership revocation and attributed moderation', async () => {
    const page = await (await request('/admin/')).text();
    assert.match(page, /Mit GitHub anmelden/);
    assert.match(page, /id="login" hidden/);
    assert.equal((await request('/api/admin/login', { password: 'anything' })).status, 404);
    const pending = await startLogin();
    const callback = `/api/admin/github/callback?state=${pending.state}&code=valid`;
    assert.equal((await request(callback)).status, 403);
    assert.equal(identificationCalls, 0);
    const ownerLogin = await request(callback, undefined, pending.cookie);
    assert.equal(ownerLogin.status, 302);
    assert.equal((await request(callback, undefined, pending.cookie)).status, 403);
    const ownerCookie = sessionCookie(ownerLogin);
    assert.equal((await request('/api/admin/me', undefined, ownerCookie)).status, 200);
    assert.equal((await request('/api/admin/audit/admin', undefined, ownerCookie)).status, 200);
    assert.equal((await request('/api/admin/audit/moderation?before=bad', undefined, ownerCookie)).status, 400);
    assert.equal((await request('/api/admin/moderators', { githubLogin: '../bad', enabled: true }, ownerCookie)).status, 400);
    assert.equal(lookupCalls, 0);
    assert.equal((await request('/api/admin/moderators', { githubLogin: 'missing', enabled: true }, ownerCookie)).status, 404);
    assert.equal((await request('/api/admin/moderators', { githubLogin: 'failure', enabled: true }, ownerCookie)).status, 503);
    assert.equal((await request('/api/admin/moderators', { githubLogin: 'owner', enabled: true }, ownerCookie)).status, 400);
    assert.equal(members.size, 0);
    assert.equal((await request('/api/admin/moderators', { githubId: '2', enabled: true }, ownerCookie, 'https://evil.test')).status, 403);
    assert.equal(members.size, 0);
    assert.equal((await request('/api/admin/moderators', { githubId: '1', enabled: false }, ownerCookie)).status, 400);
    assert.equal((await request('/api/admin/moderators', { githubLogin: '@moderator', enabled: true }, ownerCookie)).status, 204);
    assert.deepEqual(lastMembership, { id: '2', enabled: true, actor: 'github:1', login: 'moderator' });
    identity = { id: '2', login: 'moderator' };
    const moderatorLogin = await signIn();
    const moderatorCookie = sessionCookie(moderatorLogin);
    assert.equal((await request('/api/admin/moderators', undefined, moderatorCookie)).status, 403);
    assert.equal((await request('/api/admin/audit/admin', undefined, moderatorCookie)).status, 403);
    const moderationAudit = await request('/api/admin/audit/moderation', undefined, moderatorCookie);
    assert.equal(moderationAudit.status, 200);
    assert.equal((await moderationAudit.json())[0].actor, 'github:2');
    assert.equal((await request('/api/admin/moderators', { githubId: '3', enabled: true }, moderatorCookie)).status, 403);
    assert.equal((await request('/api/admin/reports/1/approve', {}, moderatorCookie)).status, 204);
    assert.equal(actor, 'github:2');
    assert.equal((await request('/api/admin/moderators', { githubId: '2', enabled: false }, ownerCookie)).status, 204);
    assert.equal((await request('/api/admin/reports', undefined, moderatorCookie)).status, 401);
    assert.equal((await signIn()).status, 403);
    identity = { id: '1', login: 'owner' };
    const failure = await startLogin();
    const response = await request(`/api/admin/github/callback?state=${failure.state}&code=failure`, undefined, failure.cookie);
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /secret/);
});
