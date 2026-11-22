const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { readFile, stat } = require('node:fs/promises');
const { gunzipSync } = require('node:zlib');
process.env.ADMIN_PASSWORD = 'long-test-password';
delete process.env.ADMIN_PASSWORD_HASH;
process.env.ADMIN_ORIGIN = 'https://example.test';
process.env.API_ADMIN_LOGIN_LIMIT_MAX = '10';
const app = express();
app.use(express.json());
let reports = 0,
    decisions = 0,
    invalidations = 0;
const backupFile = Buffer.from('{"format":"test-backup"}');
const backupRepo = require('../libs/backupRepo');
backupRepo.createBackup = async function* () {
    yield backupFile;
};
let restoredFile;
let restoredBytes;
let restoredPath;
backupRepo.restoreBackup = async (file) => {
    restoredPath = file;
    restoredBytes = (await stat(file)).size;
    if (restoredBytes < 1024) {
        restoredFile = await readFile(file);
    }
};
let cacheResets = 0;
require('../routes/moderation')(
    app,
    {
        report: async () => {
            reports++;
            return true;
        },
        list: async () => [{ id: 1, reason: 'test' }],
        reportCounts: async () => ({ all: 81, pending: 12, approved: 50, rejected: 13, blocked: 6 }),
        previews: async (ids) => ids.map((id) => ({ id, sizeX: 1, sizeY: 1, animated: true, pixels: '[1],[2]' })),
        decide: async (id, action) => {
            decisions++;
            assert.ok(['approve', 'block', 'unblock'].includes(action));
            return true;
        },
    },
    {
        invalidateAll() {
            cacheResets++;
        },
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
    assert.deepEqual(await (await req('/api/admin/reports', undefined, headers)).json(), [{ id: 1, reason: 'test' }]);
    const page = await (await req('/api/admin/reports?includeCounts=1', undefined, headers)).json();
    assert.equal(page.reports.length, 1);
    assert.equal(page.counts.all, 81);
    assert.equal(page.counts.blocked, 6);
    assert.equal((await req('/api/admin/icons?ids=1')).status, 401);
    assert.equal((await req('/api/admin/icons?ids=1,2,3,4,5,6,7,8,9', undefined, headers)).status, 400);
    const previews = await (await req('/api/admin/icons?ids=1,2,1', undefined, headers)).json();
    assert.deepEqual(previews.map(({ id }) => id), [1, 2]);
    assert.equal(previews[0].pixels, '[1],[2]');
    assert.equal(
        (await req('/api/admin/reports/1/approve', {}, { Cookie: headers.Cookie, Origin: 'https://evil.test' })).status,
        403
    );
    assert.equal(decisions, 0);
    assert.equal((await req('/api/admin/reports/1/__proto__', {}, headers)).status, 400);
    assert.equal((await req('/api/admin/reports/1/approve', {}, headers)).status, 204);
    assert.equal(decisions, 1);
    assert.equal(invalidations, 1);
    assert.equal((await req('/api/admin/reports/1/block', {}, headers)).status, 204);
    assert.equal((await req('/api/admin/reports/1/unblock', {}, headers)).status, 204);
    assert.equal(invalidations, 3);
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

test('backup downloads are private and restore requires origin, binary file and confirmation', async () => {
    const Origin = 'https://example.test';
    const signIn = async () => {
        const result = await req('/api/admin/login', { password: 'long-test-password' }, { Origin });
        return result.headers.get('set-cookie').split(';')[0];
    };
    const Cookie = await signIn();
    const otherSession = await signIn();
    assert.equal((await req('/api/admin/backup')).status, 401);
    const download = await req('/api/admin/backup', undefined, { Cookie });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.match(download.headers.get('content-disposition'), /^attachment; filename="?pixelit-api-backup-.*\.jsonl\.gz"?$/);
    assert.deepEqual(gunzipSync(Buffer.from(await download.arrayBuffer())), backupFile);
    const restore = (headers) => fetch('http://127.0.0.1:' + server.address().port + '/api/admin/restore', {
        method: 'POST',
        headers: { Cookie, Origin, 'Content-Type': 'application/octet-stream', ...headers },
        body: backupFile,
    });
    assert.equal((await restore({ Origin: 'https://untrusted.test' })).status, 403);
    assert.equal((await restore({})).status, 400);
    assert.equal((await restore({ 'Content-Type': 'text/plain', 'X-PixelIt-Confirm-Restore': 'replace' })).status, 415);
    assert.equal(cacheResets, 0);
    assert.equal((await restore({ 'X-PixelIt-Confirm-Restore': 'replace' })).status, 204);
    assert.deepEqual(restoredFile, backupFile);
    assert.equal(cacheResets, 1);
    assert.equal((await req('/api/admin/me', undefined, { Cookie })).status, 200);
    assert.equal((await req('/api/admin/me', undefined, { Cookie: otherSession })).status, 401);
});

test('restore accepts a streamed upload larger than 64 MiB', async () => {
    const Origin = 'https://example.test';
    const login = await req('/api/admin/login', { password: 'long-test-password' }, { Origin });
    const Cookie = login.headers.get('set-cookie').split(';')[0];
    const megabyte = Buffer.alloc(1024 * 1024);
    async function* body() {
        for (let index = 0; index < 65; index++) {
            yield megabyte;
        }
    }
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/admin/restore', {
        method: 'POST',
        headers: { Cookie, Origin, 'Content-Type': 'application/octet-stream', 'X-PixelIt-Confirm-Restore': 'replace' },
        body: body(),
        duplex: 'half',
    });
    assert.equal(response.status, 204);
    assert.equal(restoredBytes, 65 * megabyte.length);
    await assert.rejects(stat(restoredPath), { code: 'ENOENT' });
});
