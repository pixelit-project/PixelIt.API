const { test } = require('node:test');
const assert = require('node:assert/strict');
let count = 0;
let lock = 1;
let failWrite = false;
let released = 0;
let unlocked = 0;
let writes = [];
const connection = {
    async query(sql) {
        if (sql.includes('GET_LOCK')) {
            return [[{ acquired: lock }]];
        }
        if (sql.includes('RELEASE_LOCK')) {
            unlocked++;
        }
        return [[{ count }]];
    },
    async execute(sql, values) {
        if (failWrite) {
            throw new Error('write failure');
        }
        writes.push({ sql, values });
        return [{}];
    },
    release() {
        released++;
    },
};
const mysql = require.resolve('mysql2/promise');
require.cache[mysql] = {
    id: mysql, filename: mysql, loaded: true,
    exports: { createPool: () => ({ getConnection: async () => connection }) },
};
const repo = require('../libs/moderationRepo');
test('directory writes are parameterized, capped and release the distributed lock on failure', async () => {
    assert.equal(await repo.setModerator('2', true, 'github:1'), true);
    assert.deepEqual(writes[0].values, ['2', 'github:1']);
    count = 100;
    assert.equal(await repo.setModerator('3', true, 'github:1'), false);
    assert.equal(writes.length, 1);
    assert.equal(await repo.setModerator('2', false, 'github:1'), true);
    assert.match(writes[1].sql, /DELETE/);
    assert.deepEqual(writes[1].values, ['2']);
    failWrite = true;
    await assert.rejects(repo.setModerator('2', false, 'github:1'));
    assert.equal(unlocked, 4);
    assert.equal(released, 4);
    lock = 0;
    await assert.rejects(repo.setModerator('2', false, 'github:1'));
    assert.equal(unlocked, 4);
    assert.equal(released, 5);
});
