const { test } = require('node:test');
const assert = require('node:assert/strict');
const failure = new Error('database unavailable');
let query = async () => [[{ id: 1 }]];
let execute = async () => { throw failure; };
const transactionEvents = [];
const database = {
    execute: (...args) => execute(...args),
    beginTransaction: async () => transactionEvents.push('begin'),
    commit: async () => transactionEvents.push('commit'),
    rollback: async () => transactionEvents.push('rollback'),
    release: () => transactionEvents.push('release'),
};
require.cache[require.resolve('mysql2/promise')] = { loaded: true, exports: {
    createPool: () => ({
        query: (...args) => query(...args),
        execute: (...args) => execute(...args),
        getConnection: async () => database,
    }),
} };
require.cache[require.resolve('../libs/logger')] = { loaded: true, exports: { error: () => {} } };
const repo = require('../libs/pixelItRepo');

test('repository propagates telemetry and bitmap persistence failures', async () => {
    await assert.rejects(repo.saveTelemetry({}), error => error === failure);
    await assert.rejects(repo.saveBMP({ userName: 'Test' }), error => error === failure);
});

test('empty bitmap and telemetry tables are valid results', async () => {
    query = async sql => sql.includes('JSON_ARRAYAGG') ? [[{ sensors: null }]] : [[]];
    assert.equal(await repo.getBMPNewst(), null);
    assert.deepEqual(await repo.getStatistics(), {
        buildStats: [], versionStats: [], matrixStats: [], countryStats: [], sensorStats: [],
    });
});

test('read operations propagate database failures instead of returning empty success responses', async () => {
    query = async () => { throw failure; };
    for (const load of [
        () => repo.getBMPByID('1'), () => repo.getBMPByID_v2('1'), repo.getBMPNewst,
        repo.getBMPAll, repo.getUserMapData, repo.getStatistics, () => repo.isTelemetryUser('uuid'),
    ]) await assert.rejects(load(), error => error === failure);
});

test('ratings use a parameterized upsert that replaces an existing vote and fetches the saved aggregate', async () => {
    const uuid = 'a'.repeat(40);
    const calls = [];
    execute = async (sql, values) => {
        calls.push({ sql, values });
        return sql.includes('GROUP BY') ? [[{ iconId: 1, average: '3.5000', count: '2', myRating: 1 }]] : [{}];
    };
    assert.deepEqual(await repo.rateIcon(1, uuid, 1), { iconId: 1, average: 3.5, count: 2, myRating: 1 });
    assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE stars = \?/);
    assert.match(calls[0].sql, /NOT EXISTS/);
    assert.deepEqual(calls[0].values, [uuid, 1, 1, 1]);
    assert.deepEqual(calls[1].values, [uuid, 1]);
    assert.match(calls[1].sql, /AND ratings.icon_id = \?/);
    assert.match(calls[1].sql, /NOT EXISTS/);
    assert.match(calls[2].sql, /INSERT INTO pixel_it_icon_rating_submissions/);
    assert.match(calls[2].sql, /UTC_DATE\(\)/);
    assert.deepEqual(transactionEvents.splice(0), ['begin', 'commit', 'release']);
});

test('unavailable icons do not count and failed counter writes roll the vote back', async () => {
    let counterWrites = 0;
    execute = async (sql) => {
        if (sql.includes('icon_rating_submissions')) counterWrites++;
        return [[]];
    };
    assert.equal(await repo.rateIcon(1, 'a'.repeat(40), 5), null);
    assert.equal(counterWrites, 0);
    assert.deepEqual(transactionEvents.splice(0), ['begin', 'rollback', 'release']);

    execute = async (sql) => {
        if (sql.includes('icon_rating_submissions')) throw failure;
        return [[{ iconId: 1, average: '5', count: '1', myRating: 5 }]];
    };
    await assert.rejects(repo.rateIcon(1, 'a'.repeat(40), 5), error => error === failure);
    assert.deepEqual(transactionEvents.splice(0), ['begin', 'rollback', 'release']);
});

test('only the catalog excludes hidden bitmaps, while all public bitmap and rating reads exclude blocked icons', async () => {
    const calls = [];
    query = async (sql) => {
        calls.push(sql);
        return [[]];
    };
    execute = query;
    await repo.getBMPAll();
    assert.match(calls.shift(), /r\.status IN \('approved', 'blocked'\)/);
    for (const load of [
        () => repo.getBMPByID('1'),
        () => repo.getBMPByID_v2('1'),
        repo.getBMPNewst,
        () => repo.getIconRatings(null),
    ]) {
        await load();
        const sql = calls.shift();
        assert.match(sql, /\.status = 'blocked'/);
        assert.doesNotMatch(sql, /'approved'/);
    }
});
