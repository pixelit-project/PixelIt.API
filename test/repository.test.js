const { test } = require('node:test');
const assert = require('node:assert/strict');
const failure = new Error('database unavailable');
let query = async () => [[{ id: 1 }]];
require.cache[require.resolve('mysql2/promise')] = { loaded: true, exports: {
    createPool: () => ({ query: (...args) => query(...args), execute: async () => { throw failure; } }),
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
