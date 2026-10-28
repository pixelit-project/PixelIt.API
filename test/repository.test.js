const { test } = require('node:test');
const assert = require('node:assert/strict');
const failure = new Error('database unavailable');
require.cache[require.resolve('mysql2/promise')] = { loaded: true, exports: {
    createPool: () => ({ query: async () => [[{ id: 1 }]], execute: async () => { throw failure; } }),
} };
require.cache[require.resolve('../libs/logger')] = { loaded: true, exports: { error: () => {} } };
const repo = require('../libs/pixelItRepo');

test('repository propagates telemetry and bitmap persistence failures', async () => {
    await assert.rejects(repo.saveTelemetry({}), error => error === failure);
    await assert.rejects(repo.saveBMP({ userName: 'Test' }), error => error === failure);
});
