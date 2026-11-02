const { test } = require('node:test');
const assert = require('node:assert/strict');
const calls = [];
const mysql = require.resolve('mysql2/promise');
require.cache[mysql] = {
    id: mysql, filename: mysql, loaded: true,
    exports: { createPool: () => ({
        async execute(sql, values) {
            calls.push({ sql, values });
            return [[{ id: 1 }]];
        },
    }) },
};
const repo = require('../libs/moderationRepo');
test('audit pages are parameterized and bounded without disclosing report text or credentials', async () => {
    assert.deepEqual(await repo.listModerationAudit(100), [{ id: 1 }]);
    assert.match(calls[0].sql, /pixel_it_moderation_audit/);
    assert.match(calls[0].sql, /actor_login/);
    assert.match(calls[0].sql, /WHERE a.id < \?/);
    assert.match(calls[0].sql, /ORDER BY a.id DESC\s+LIMIT 50/);
    assert.doesNotMatch(calls[0].sql, /reason|token|chat_id/i);
    assert.deepEqual(calls[0].values, [100]);
    assert.deepEqual(await repo.listAdminAudit(50), [{ id: 1 }]);
    assert.match(calls[1].sql, /pixel_it_admin_audit/);
    assert.match(calls[1].sql, /WHERE id < \?/);
    assert.match(calls[1].sql, /ORDER BY id DESC\s+LIMIT 50/);
    assert.deepEqual(calls[1].values, [50]);
});
