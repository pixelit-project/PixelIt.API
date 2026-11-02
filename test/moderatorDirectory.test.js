const { test } = require('node:test');
const assert = require('node:assert/strict');
let count = 0;
let lock = 1;
let failAudit = false;
let existing = [];
let calls = [];
const connection = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    async query(sql) {
        calls.push(sql);
        if (sql.includes('GET_LOCK')) {
            return [[{ acquired: lock }]];
        }
        return [[{ count }]];
    },
    async execute(sql, values) {
        calls.push({ sql, values });
        if (sql.includes('SELECT m.github_id')) {
            return [existing];
        }
        if (failAudit && sql.includes('INSERT INTO pixel_it_admin_audit')) {
            throw new Error('audit write failed');
        }
        return [{ affectedRows: 1 }];
    },
    release() {
        calls.push('release');
    },
};
const mysql = require.resolve('mysql2/promise');
require.cache[mysql] = {
    id: mysql, filename: mysql, loaded: true,
    exports: { createPool: () => ({ getConnection: async () => connection }) },
};
const repo = require('../libs/moderationRepo');
const writes = () => calls.filter((call) => typeof call === 'object');
test('membership and its named admin audit commit together, with bounded membership and no duplicate events', async () => {
    assert.equal(await repo.setModerator('2', true, 'github:1', 'octocat', 'owner'), true);
    assert.deepEqual(writes().find((call) => call.sql.includes('INSERT INTO pixel_it_admin_audit')).values,
        ['moderator_added', 'github:1', 'owner', '2', 'octocat']);
    assert.ok(calls.indexOf('commit') > calls.indexOf('begin'));
    assert.equal(calls.at(-1), 'release');
    count = 100;
    calls = [];
    assert.equal(await repo.setModerator('3', true, 'github:1'), false);
    assert.ok(calls.includes('rollback'));
    assert.ok(!writes().some((call) => call.sql.includes('INSERT INTO pixel_it_admin_audit')));
    existing = [{ github_id: '2', github_login: 'octocat' }];
    calls = [];
    assert.equal(await repo.setModerator('2', true, 'github:1', 'renamed'), true);
    assert.ok(!writes().some((call) => call.sql.includes('INSERT INTO pixel_it_admin_audit')));
    calls = [];
    assert.equal(await repo.setModerator('2', false, 'github:1', null, 'owner'), true);
    assert.deepEqual(writes().find((call) => call.sql.includes('INSERT INTO pixel_it_admin_audit')).values,
        ['moderator_removed', 'github:1', 'owner', '2', 'octocat']);
    assert.ok(writes().some((call) => call.sql.includes('DELETE FROM pixel_it_telegram')));
    assert.ok(writes().some((call) => call.sql.includes('DELETE FROM pixel_it_moderators')));
});

test('audit failures roll back membership changes and always release the directory lock', async () => {
    failAudit = true;
    calls = [];
    await assert.rejects(repo.setModerator('2', false, 'github:1'), /audit write failed/);
    assert.ok(calls.includes('rollback'));
    assert.ok(!calls.includes('commit'));
    assert.ok(calls.some((call) => typeof call === 'string' && call.includes('RELEASE_LOCK')));
    assert.equal(calls.at(-1), 'release');
    lock = 0;
    calls = [];
    await assert.rejects(repo.setModerator('2', false, 'github:1'), /busy/);
    assert.ok(!calls.includes('begin'));
    assert.equal(calls.at(-1), 'release');
});
