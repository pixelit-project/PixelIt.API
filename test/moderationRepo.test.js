const { test } = require('node:test');
const assert = require('node:assert/strict');
let calls = [],
    exists = true,
    changed = true,
    failAudit = false;
const connection = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    query: async (sql) => {
        calls.push(sql);
        return [exists ? [{ id: 1 }] : []];
    },
    execute: async (sql, values) => {
        calls.push([sql, values]);
        if (failAudit && sql.includes('audit')) throw Error('write failed');
        return [{ affectedRows: changed ? 1 : 0 }];
    },
};
const mysql = require.resolve('mysql2/promise');
require.cache[mysql] = {
    id: mysql,
    filename: mysql,
    loaded: true,
    exports: { createPool: () => ({ getConnection: async () => connection }) },
};
const repo = require('../libs/moderationRepo');
test('report creation locks bitmap and avoids duplicate pending or approved reports', async () => {
    calls = [];
    assert.equal(await repo.report(1, 'reason'), true);
    assert.ok(calls.some((c) => typeof c === 'string' && c.includes('FOR UPDATE')));
    assert.ok(calls.some((c) => Array.isArray(c) && c[0].includes('NOT EXISTS') && c[1][1] === 'reason'));
    assert.deepEqual(calls.slice(-2), ['commit', 'release']);
    exists = false;
    calls = [];
    assert.equal(await repo.report(1, 'reason'), false);
    assert.deepEqual(calls.slice(-2), ['rollback', 'release']);
});
test('decision and audit commit together, rollback failures and reject repeated decisions', async () => {
    calls = [];
    assert.equal(await repo.decide(1, 'restore'), true);
    assert.deepEqual(calls.find((c) => Array.isArray(c) && c[0].startsWith('UPDATE'))[1], ['rejected', 1, 'approved']);
    assert.deepEqual(calls.slice(-2), ['commit', 'release']);
    failAudit = true;
    calls = [];
    await assert.rejects(repo.decide(1, 'approve'), /write failed/);
    assert.deepEqual(calls.slice(-2), ['rollback', 'release']);
    failAudit = false;
    changed = false;
    calls = [];
    assert.equal(await repo.decide(1, 'approve'), false);
    assert.deepEqual(calls.slice(-2), ['rollback', 'release']);
    assert.ok(!calls.some((c) => Array.isArray(c) && c[0].includes('audit')));
});
