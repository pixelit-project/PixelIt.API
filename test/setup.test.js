const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const credentials = require('../libs/adminCredentials');

test('plain admin password is derived internally; invalid or missing configuration stays disabled', async () => {
    const verify = await credentials({ ADMIN_PASSWORD: 'a-long-admin-password' });
    assert.equal(await verify('a-long-admin-password'), true);
    assert.equal(await verify('wrong-password'), false);
    assert.equal(await verify({}), false);
    assert.equal(await credentials({}), null);
    assert.equal(await credentials({ ADMIN_PASSWORD: '' }), null);
    assert.equal(await credentials({ ADMIN_PASSWORD: 'short' }), null);
    assert.equal(await credentials({ ADMIN_PASSWORD: 'x'.repeat(1025) }), null);
    assert.equal(await credentials({ ADMIN_PASSWORD_HASH: 'invalid' }), null);
});
test('existing hashes remain supported; direct password takes precedence', async () => {
    const salt = 'a'.repeat(32);
    const hash = 'scrypt:' + salt + ':' + crypto.scryptSync('existing-password', salt, 64).toString('hex');
    assert.equal(await (await credentials({ ADMIN_PASSWORD_HASH: hash }))('existing-password'), true);
    const verify = await credentials({ ADMIN_PASSWORD: 'new-admin-password', ADMIN_PASSWORD_HASH: hash });
    assert.equal(await verify('new-admin-password'), true);
    assert.equal(await verify('existing-password'), false);
});
test('server only listens after migration success, and never listens on failure', async () => {
    const start = require('../libs/startServer');
    const { EventEmitter } = require('node:events');
    let migrated = false,
        listened = false;
    const app = {
        listen() {
            assert.equal(migrated, true);
            listened = true;
            const server = new EventEmitter();
            process.nextTick(() => server.emit('listening'));
            return server;
        },
    };
    await start(app, 8080, async () => {
        migrated = true;
    });
    assert.equal(listened, true);
    listened = false;
    await assert.rejects(
        start(app, 8080, async () => {
            throw Error('migration failed');
        }),
        /migration failed/
    );
    assert.equal(listened, false);
});
