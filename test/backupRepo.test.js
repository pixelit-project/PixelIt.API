const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createGzip, gunzipSync, gzipSync } = require('node:zlib');

const mysqlPath = require.resolve('mysql2');
const mysql = require('mysql2');
const tableNames = [
    'pixel_it_user', 'pixel_it_bitmap', 'pixel_it_hitcount', 'pixel_it_telemetry',
    'pixel_it_reports', 'pixel_it_moderation_audit', 'pixel_it_github_names', 'pixel_it_admin_audit',
    'pixel_it_moderators', 'pixel_it_telegram', 'pixel_it_icon_ratings', 'pixel_it_icon_downloads',
];
const schema = tableNames.flatMap((tableName) => [{
    tableName, columnName: 'id', dataType: 'bigint', columnType: 'bigint unsigned', nullable: 'NO', engine: 'InnoDB',
}, ...(tableName === 'pixel_it_icon_ratings' ? [{
    tableName, columnName: 'voter_uuid', dataType: 'binary', columnType: 'binary(20)', nullable: 'NO', engine: 'InnoDB',
}] : [])]);
const id = '9007199254740993';
const binaryUuid = Buffer.from('deadbeef'.repeat(5), 'hex');
let calls = [];
let failInsert = false;
let largeRows = 0;
let insertedRows = 0;
const connection = {
    query: async (sql) => {
        calls.push(sql);
        return [schema];
    },
    execute: async (sql, values) => {
        if (largeRows > 0) {
            insertedRows += values.length;
        } else {
            calls.push([sql, values]);
        }
        if (failInsert && sql.includes('icon_ratings')) {
            throw new Error('write failed');
        }
    },
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
};
require.cache[mysqlPath].exports = {
    escapeId: mysql.escapeId,
    createPool: () => ({
        getConnection: (callback) => callback(null, {
            promise: () => connection,
            query: ({ sql, rowsAsArray }) => {
                assert.equal(rowsAsArray, true);
                function* rows() {
                    if (largeRows > 0 && sql.includes('pixel_it_bitmap')) {
                        const payload = 'x'.repeat(1024 * 1024);
                        for (let index = 0; index < largeRows; index++) {
                            yield [payload];
                        }
                    } else if (!largeRows && sql.includes('icon_ratings')) {
                        yield [id, binaryUuid];
                    }
                }
                return { stream: () => Readable.from(rows()) };
            },
        }),
        promise: () => ({ getConnection: async () => connection }),
    }),
};
const { createBackup, restoreBackup } = require('../libs/backupRepo');

async function exportFixture(testContext) {
    const directory = await mkdtemp(join(tmpdir(), 'pixelit-backup-test-'));
    testContext.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'backup.jsonl.gz');
    await pipeline(createBackup(), createGzip(), createWriteStream(path));
    return path;
}

test('backup and restore preserve large IDs and binary fields and replace tables in one transaction', async (t) => {
    const file = await exportFixture(t);
    assert.ok(calls.some((sql) => sql.includes?.('WITH CONSISTENT SNAPSHOT')));
    assert.deepEqual(calls.slice(-2), ['commit', 'release']);
    const [manifest] = gunzipSync(await readFile(file)).toString().split('\n');
    assert.equal(JSON.parse(manifest).tables.length, tableNames.length);
    calls = [];
    await restoreBackup(file);
    const deletes = calls.filter((call) => typeof call === 'string' && call.startsWith('DELETE'));
    assert.deepEqual(deletes, [...tableNames].reverse().map((name) => 'DELETE FROM `' + name + '`'));
    const [[sql, values]] = calls.filter(Array.isArray);
    assert.match(sql, /VALUES \(\?, \?\)/);
    assert.deepEqual(values, [id, binaryUuid]);
    assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('restore rejects invalid or incomplete archives before deleting anything and rolls back failed inserts', async (t) => {
    const file = await exportFixture(t);
    const valid = await readFile(file);
    const records = gunzipSync(valid).toString().trimEnd().split('\n');
    for (const invalid of [
        valid.subarray(0, -6),
        gzipSync(records.slice(0, -1).join('\n') + '\n'),
        gzipSync(records.join('\n').replace(binaryUuid.toString('hex'), 'wrong') + '\n'),
    ]) {
        await writeFile(file, invalid);
        calls = [];
        await assert.rejects(restoreBackup(file), { code: 'INVALID_BACKUP' });
        assert.ok(!calls.some((call) => typeof call === 'string' && call.startsWith('DELETE')));
    }
    failInsert = true;
    try {
        await writeFile(file, valid);
        calls = [];
        await assert.rejects(restoreBackup(file), /write failed/);
        assert.ok(calls.includes('begin'));
        assert.ok(!calls.includes('commit'));
        assert.deepEqual(calls.slice(-2), ['rollback', 'release']);
    } finally {
        failInsert = false;
    }
});

test('streamed backup and restore process more than 64 MiB of uncompressed records', async (t) => {
    largeRows = 65;
    calls = [];
    insertedRows = 0;
    try {
        const file = await exportFixture(t);
        await restoreBackup(file);
        assert.equal(insertedRows, 65);
        assert.deepEqual(calls.slice(-2), ['commit', 'release']);
    } finally {
        largeRows = 0;
    }
});

test('restore accepts a legacy JSON backup from a compatible schema', async (t) => {
    const file = await exportFixture(t);
    const [manifest, record] = gunzipSync(await readFile(file)).toString().trimEnd().split('\n').map(JSON.parse);
    for (const table of manifest.tables) {
        table.rows = [];
    }
    manifest.format = 'pixelit-api-backup-v1';
    manifest.tables.pop();
    manifest.tables[record[0]].rows.push(record[1]);
    await writeFile(file, JSON.stringify(manifest));
    calls = [];
    await restoreBackup(file);
    assert.deepEqual(calls.filter(Array.isArray)[0][1], [id, binaryUuid]);
});
