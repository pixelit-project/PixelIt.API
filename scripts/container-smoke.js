// Run inside the built image with this file mounted read-only (see CI workflow).
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { once } = require('node:events');

async function main() {
    assert.notEqual(process.getuid(), 0, 'the API must run as an unprivileged user');
    for (const path of ['node_modules/nodemon', '.env', '.git', 'test']) {
        assert.equal(existsSync(`/usr/src/app/${path}`), false, `${path} must not be in the production image`);
    }
    const app = require('/usr/src/app/main');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
        const options = { signal: AbortSignal.timeout(5000) };
        assert.equal((await fetch(`${url}/api/GetBMPByID/invalid`, options)).status, 400);
        assert.equal((await fetch(`${url}/api/SaveBitmap`, {
            ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        })).status, 400);
        // No database runs in this container: a connection failure must be handled.
        const failure = await fetch(`${url}/api/GetBMPAll`, options);
        assert.equal(failure.status, 500);
        assert.equal(await failure.text(), 'Internal server error');
        console.log('Container smoke checks passed.');
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
