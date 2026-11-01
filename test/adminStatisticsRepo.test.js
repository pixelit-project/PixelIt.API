const { test } = require('node:test');
const assert = require('node:assert/strict');
let results = [];
let failure;
const mysqlPath = require.resolve('mysql2/promise');
require.cache[mysqlPath] = {
    loaded: true,
    exports: {
        createPool: () => ({
            async query() {
                if (failure) throw failure;
                return [results.shift() || []];
            },
        }),
    },
};
const repo = require('../libs/pixelItRepo');

test('admin aggregates normalize MySQL counts and return no device identifiers or geoip', async () => {
    results = [
        [{ total: '10', active24h: '3', active7d: '5', active30d: '8', lastSeen: '2026-11-01T12:00:00Z' }],
        [{ label: '3.4.0', count: '8' }],
        [{ label: 'ESP32', count: '8' }],
        [{ label: '8×32', count: '8' }],
    ];
    const stats = await repo.getAdminStatistics();
    assert.equal(stats.total, 10);
    assert.equal(stats.active24h, 3);
    assert.equal(stats.active7d, 5);
    assert.equal(stats.active30d, 8);
    assert.deepEqual(stats.versions, [{ label: '3.4.0', count: 8 }]);
    assert.deepEqual(
        Object.keys(stats).sort(),
        [
            'total',
            'active24h',
            'active7d',
            'active30d',
            'lastSeen',
            'versions',
            'hardware',
            'matrices',
            'generatedAt',
        ].sort()
    );
});
test('an empty telemetry table returns zeros and empty distributions', async () => {
    results = [[{ total: 0, active24h: null, active7d: null, active30d: null, lastSeen: null }], [], [], []];
    const stats = await repo.getAdminStatistics();
    assert.equal(stats.total, 0);
    assert.equal(stats.active30d, 0);
    assert.equal(stats.lastSeen, null);
    assert.deepEqual(stats.versions, []);
    assert.deepEqual(stats.hardware, []);
    assert.deepEqual(stats.matrices, []);
});
test('database failures are propagated instead of showing false zeros', async () => {
    failure = new Error('database unavailable');
    await assert.rejects(repo.getAdminStatistics(), (error) => error === failure);
});
