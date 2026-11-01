const { test } = require('node:test');
const assert = require('node:assert/strict');
let queries = [],
    applied = new Map(),
    failDDL = false,
    lock = 1,
    ended = 0;
const connection = {
    async query(sql) {
        queries.push(sql);
        if (sql.includes('GET_LOCK')) return [[{ acquired: lock }]];
        if (failDDL && sql.includes('CREATE TABLE IF NOT EXISTS pixel_it_moderation_audit')) throw Error('DDL failed');
        return [[]];
    },
    async execute(sql, values) {
        queries.push(sql);
        if (sql.startsWith('SELECT checksum'))
            return [applied.has(values[0]) ? [{ checksum: applied.get(values[0]) }] : []];
        applied.set(values[0], values[1]);
        return [{}];
    },
    async end() {
        ended++;
    },
};
const mysql = require.resolve('mysql2/promise');
require.cache[mysql] = {
    id: mysql,
    filename: mysql,
    loaded: true,
    exports: { createConnection: async () => connection },
};
const migrate = require('../libs/migrations');
test('migrations create tables, track checksums and skip already applied DDL', async () => {
    await migrate();
    assert.equal(applied.size, 1);
    assert.equal(ended, 1);
    assert.ok(queries.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS pixel_it_reports')));
    assert.ok(queries.some((sql) => sql.includes('RELEASE_LOCK')));
    queries = [];
    await migrate();
    assert.ok(!queries.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS pixel_it_reports')));
});
test('partial DDL failure is retryable and is never marked complete', async () => {
    applied.clear();
    queries = [];
    failDDL = true;
    await assert.rejects(migrate(), /DDL failed/);
    assert.equal(applied.size, 0);
    assert.ok(queries.some((sql) => sql.includes('RELEASE_LOCK')));
    failDDL = false;
    await migrate();
    assert.equal(applied.size, 1);
});
test('lock timeout and modified migration fail closed and close connections', async () => {
    const previous = ended;
    lock = 0;
    await assert.rejects(migrate(), /lock unavailable/);
    assert.equal(ended, previous + 1);
    lock = 1;
    applied.set('001-moderation.sql', 'wrong');
    await assert.rejects(migrate(), /modified/);
});
