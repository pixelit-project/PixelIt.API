const { test } = require('node:test');
const assert = require('node:assert/strict');
const createRepo = require('../libs/telegramRepo');

test('Telegram link redemption is expiry-checked, authorized and consumes its hash in one update', async () => {
    let affectedRows = 1;
    const repo = createRepo({
        async execute(sql, values) {
            assert.match(sql, /link_expires_at > UTC_TIMESTAMP\(\)/);
            assert.match(sql, /link_hash = NULL/);
            assert.match(sql, /pixel_it_moderators/);
            assert.deepEqual(values, ['456', 'hashed-code', '1']);
            return [{ affectedRows }];
        },
    });
    assert.equal(await repo.connect('hashed-code', '456', '1'), true);
    affectedRows = 0;
    assert.equal(await repo.connect('hashed-code', '456', '1'), false);
});

test('Telegram claims lock and reset counts transactionally, checking cooldown and current membership', async () => {
    const calls = [];
    let rows = [{ pending_count: 5 }];
    const repo = createRepo({ getConnection: async () => ({
        beginTransaction: async () => calls.push('begin'),
        commit: async () => calls.push('commit'),
        rollback: async () => calls.push('rollback'),
        release: () => calls.push('release'),
        async execute(sql, values) {
            if (sql.includes('SELECT pending_count')) {
                assert.match(sql, /FOR UPDATE/);
                assert.match(sql, /INTERVAL 1 MINUTE/);
                assert.match(sql, /pixel_it_moderators/);
                assert.deepEqual(values, ['2', '456', '1']);
                return [rows];
            }
            assert.match(sql, /pending_count = 0/);
            calls.push('reset');
            return [{}];
        },
    }) });
    assert.equal(await repo.claim('2', '456', '1'), 5);
    assert.deepEqual(calls, ['begin', 'reset', 'commit', 'release']);
    calls.length = 0;
    rows = [];
    assert.equal(await repo.claim('2', '456', '1'), 0);
    assert.deepEqual(calls, ['begin', 'rollback', 'release']);
});
