const { test } = require('node:test');
const assert = require('node:assert/strict');
let results = [];
let failure;
let queries = [];
const mysqlPath = require.resolve('mysql2/promise');
require.cache[mysqlPath] = {
    loaded: true,
    exports: {
        createPool: () => ({
            async execute(sql, parameters) {
                return this.query(sql, parameters);
            },
            async query(sql, parameters) {
                queries.push({ sql, parameters });
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
test('both statistics endpoints validate matrix names before grouping', async () => {
    queries = [];
    results = [[], [], [], [], [{ sensors: [] }]];
    await repo.getStatistics();
    await repo.getAdminStatistics();
    const matrixQueries = queries.filter(({ sql }) => sql.includes("JSON_EXTRACT(matrix, '$.name')"));
    assert.equal(matrixQueries.length, 2);
    for (const { sql, parameters } of matrixQueries) {
        assert.deepEqual(parameters, [
            'Colum major', 'Column major', 'Row major',
            'Tiled 4x 8x8 CJMCU (Column major)', 'MicroMatrix',
            'Tiled 4x 8x8 CJMCU (Row major)',
        ]);
        assert.match(sql, /CAST\(JSON_UNQUOTE[\s\S]*AS BINARY\)/);
        assert.match(sql, /IN \(\?, \?, \?, \?, \?, \?\)/);
        assert.match(sql, /ELSE 'Custom'[\s\S]*END[\s\S]*COUNT\(\*\)/);
        assert.match(sql, /GROUP BY (1|label)/);
        assert.doesNotMatch(sql, /JSON_EXTRACT\(sensors/);
    }
});

test('icon rating statistics normalize totals and preserve the three ranking orders', async () => {
    results = [
        [{ day: '2026-11-22', count: '7' }],
        [{ stars: 5, count: '4' }, { stars: 1, count: '1' }],
        [
            { iconId: 22, name: 'Sun', average: '5.0000', count: '4', mostRank: 1, bestRank: 1, worstRank: 2 },
            { iconId: 13, name: 'Cloud', average: '1.0000', count: '1', mostRank: 2, bestRank: 2, worstRank: 1 },
        ],
    ];
    const stats = await repo.getAdminIconRatings(30);
    assert.equal(stats.total, 5);
    assert.equal(stats.days, 30);
    assert.deepEqual(stats.daily, [{ day: '2026-11-22', count: 7 }]);
    assert.equal(stats.average, 4.2);
    assert.deepEqual(stats.stars.map(({ count }) => count), [4, 0, 0, 0, 1]);
    assert.deepEqual(stats.mostRated.map(({ iconId }) => iconId), [22, 13]);
    assert.deepEqual(stats.bestRated[0], { iconId: 22, name: 'Sun', average: 5, count: 4 });
    assert.deepEqual(stats.worstRated[0], { iconId: 13, name: 'Cloud', average: 1, count: 1 });
});

test('empty icon rating statistics return no average or rankings', async () => {
    results = [[], [], []];
    const stats = await repo.getAdminIconRatings(30);
    assert.equal(stats.total, 0);
    assert.equal(stats.average, null);
    assert.deepEqual(stats.mostRated, []);
    assert.deepEqual(stats.bestRated, []);
    assert.deepEqual(stats.worstRated, []);
});

test('database failures are propagated instead of showing false zeros', async () => {
    failure = new Error('database unavailable');
    await assert.rejects(repo.getAdminStatistics(), (error) => error === failure);
});
