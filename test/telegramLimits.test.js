const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.API_TELEGRAM_WEBHOOK_LIMIT_MAX = '2';
const app = express();
require('../routes/moderation')(app, {}, {}, {});
const server = app.listen(0, '127.0.0.1');
after(() => new Promise((resolve) => server.close(resolve)));
test('Telegram webhook counts authentication failures toward its independent limit', async () => {
    if (!server.listening) {
        await new Promise((resolve) => server.once('listening', resolve));
    }
    const url = `http://127.0.0.1:${server.address().port}/api/telegram/webhook`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 403);
    assert.equal((await fetch(url, { method: 'POST' })).status, 403);
    const limited = await fetch(url, { method: 'POST' });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('ratelimit-limit'), '2');
});
