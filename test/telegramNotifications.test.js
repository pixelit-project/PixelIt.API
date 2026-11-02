const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const createTelegram = require('../libs/telegramNotifications');
const env = {
    ADMIN_GITHUB_CLIENT_ID: 'client', ADMIN_GITHUB_CLIENT_SECRET: 'secret', ADMIN_GITHUB_OWNER_ID: '1',
    ADMIN_ORIGIN: 'https://example.test', TELEGRAM_BOT_TOKEN: '123:' + 't'.repeat(30),
    TELEGRAM_BOT_USERNAME: 'PixelItTestBot', TELEGRAM_WEBHOOK_SECRET: 's'.repeat(32),
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
test('Telegram links are hashed, single-use and private-chat only; stop removes subscriptions', async () => {
    let savedHash;
    let connections = 0;
    let stopped;
    const repo = {
        status: async () => ({ connected: false, pending: true }),
        link: async (id, value, owner) => {
            assert.equal(id, '2');
            assert.equal(owner, '1');
            savedHash = value;
            return true;
        },
        connect: async (value, chat, owner) => {
            assert.equal(chat, '456');
            assert.equal(owner, '1');
            if (value !== savedHash) {
                return false;
            }
            savedHash = null;
            connections++;
            return true;
        },
        stop: async (chat) => { stopped = chat; },
    };
    const service = createTelegram(repo, env);
    assert.equal(service.enabled, true);
    assert.equal(service.authorized(env.TELEGRAM_WEBHOOK_SECRET), true);
    assert.equal(service.authorized('wrong'), false);
    assert.equal(service.authorized(undefined), false);
    assert.equal(createTelegram(repo, { ...env, TELEGRAM_WEBHOOK_SECRET: '' }).enabled, false);
    assert.equal((await service.status('2')).pending, true);
    const link = await service.link('2');
    const code = new URL(link.url).searchParams.get('start');
    assert.equal(savedHash, hash(code));
    assert.notEqual(savedHash, code);
    assert.equal(link.expiresIn, 300);
    const message = { chat: { id: 456, type: 'private' }, from: { id: 456 }, text: '/start ' + code };
    await service.update({ message: { ...message, chat: { id: 456, type: 'group' } } });
    await service.update({ message: { ...message, from: { id: 789 } } });
    assert.equal(connections, 0);
    const confirmation = await service.update({ message });
    assert.equal(confirmation.method, 'sendMessage');
    assert.equal(confirmation.chat_id, '456');
    assert.match(confirmation.text, /Telegram is connected/);
    assert.match(confirmation.text, /new icon reports/);
    assert.match(confirmation.text, /\/stop/);
    assert.equal(await service.update({ message }), undefined);
    assert.equal(connections, 1);
    await service.update({ message: { ...message, text: '/stop' } });
    assert.equal(stopped, '456');
});

test('digests are bounded, claimed once, recheck revocation and never retry ambiguous delivery', async () => {
    const pending = new Map([['1', 3], ['2', 2], ['3', 1]]);
    const sent = [];
    const repo = {
        recipients: async () => [...pending.keys()].map((github_id) => ({ github_id, chat_id: 'chat-' + github_id })),
        claim: async (id) => {
            const count = pending.get(id);
            pending.delete(id);
            return count;
        },
        connected: async (id) => id !== '2',
    };
    const transport = {
        async post(url, body, options) {
            sent.push(body);
            assert.equal(options.timeout, 5000);
            assert.equal(options.maxRedirects, 0);
            assert.equal(options.maxContentLength, 16384);
            if (body.chat_id === 'chat-3') {
                throw new Error('timeout contains bot secret');
            }
            return { data: { ok: true } };
        },
    };
    const service = createTelegram(repo, env, transport);
    await Promise.all([service.flush(), service.flush()]);
    await service.flush();
    assert.equal(sent.length, 2);
    assert.match(sent[0].text, /3 new icon report/);
    assert.match(sent[0].text, /https:\/\/example.test\/admin\//);
    assert.equal(sent[0].parse_mode, undefined);
    let claims = 0;
    const bounded = createTelegram({
        recipients: async () => Array.from({ length: 100 }, (_, index) => ({ github_id: String(index) })),
        claim: async () => { claims++; return 0; },
    }, env, transport);
    await bounded.flush();
    assert.equal(claims, 10);
});

test('blocked chats are removed and Telegram 429 pauses later batches without retrying', async () => {
    let stopped;
    let status = 403;
    let sends = 0;
    const service = createTelegram({
        recipients: async () => [{ github_id: '1', chat_id: '456' }],
        claim: async () => 1,
        connected: async () => true,
        stop: async (chat) => { stopped = chat; },
    }, env, {
        async post() {
            sends++;
            throw { response: { status, data: { parameters: { retry_after: 120 } } } };
        },
    });
    await service.flush();
    assert.equal(stopped, '456');
    status = 429;
    await service.flush();
    await service.flush();
    assert.equal(sends, 2);
});

test('subscriptions can be inspected and removed when the bot configuration is disabled', async () => {
    let disconnected;
    const service = createTelegram({
        status: async () => ({ connected: true, pending: false }),
        disconnect: async (id) => { disconnected = id; },
    }, { ...env, TELEGRAM_BOT_TOKEN: '' });
    assert.deepEqual(await service.status('2'), { available: false, connected: true, pending: false });
    await service.disconnect('2');
    assert.equal(disconnected, '2');
});

test('startup registers the webhook once with bounded requests and preserves queued updates', async (context) => {
    let calls = 0;
    const service = createTelegram({}, env, {
        async post(url, body, options) {
            calls++;
            assert.equal(url, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`);
            assert.deepEqual(body, {
                url: 'https://example.test/api/telegram/webhook',
                secret_token: env.TELEGRAM_WEBHOOK_SECRET,
                allowed_updates: ['message'],
                max_connections: 1,
                drop_pending_updates: false,
            });
            assert.equal(options.timeout, 5000);
            assert.equal(options.maxRedirects, 0);
            assert.equal(options.maxContentLength, 16384);
            assert.equal(options.maxBodyLength, 16384);
            return { data: { ok: true } };
        },
    });
    context.after(() => service.stop());
    await Promise.all([service.start(), service.start()]);
    await service.start();
    assert.equal(calls, 1);
    service.stop();
    await service.start();
    assert.equal(calls, 2);
});

test('failed webhook registration never blocks startup, retries immediately or logs secrets', async (context) => {
    const warnings = [];
    context.mock.method(require('../libs/logger'), 'warn', (...args) => warnings.push(args));
    for (const failure of ['network', 'rejected']) {
        let calls = 0;
        const service = createTelegram({}, env, {
            async post() {
                calls++;
                if (failure === 'network') {
                    throw new Error(`${env.TELEGRAM_BOT_TOKEN} ${env.TELEGRAM_WEBHOOK_SECRET}`);
                }
                return { data: { ok: false, description: env.TELEGRAM_WEBHOOK_SECRET } };
            },
        });
        context.after(() => service.stop());
        await assert.doesNotReject(service.start());
        await service.start();
        assert.equal(calls, 1);
        service.stop();
    }
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((args) => args[0].includes('registration failed')));
    assert.ok(!JSON.stringify(warnings).includes(env.TELEGRAM_BOT_TOKEN));
    assert.ok(!JSON.stringify(warnings).includes(env.TELEGRAM_WEBHOOK_SECRET));
});

test('disabled Telegram configuration makes no webhook registration request', async () => {
    let calls = 0;
    const service = createTelegram({}, { ...env, TELEGRAM_BOT_TOKEN: '' }, {
        async post() {
            calls++;
        },
    });
    await service.start();
    assert.equal(calls, 0);
    service.stop();
});

test('webhook registration backs off to 15 minutes and stops retrying after success', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const warnings = [];
    context.mock.method(require('../libs/logger'), 'warn', (message, properties) => warnings.push(properties));
    let calls = 0;
    const service = createTelegram({}, env, {
        async post() {
            calls++;
            if (calls < 8) {
                throw new Error('temporary failure');
            }
            return { data: { ok: true } };
        },
    });
    context.after(() => service.stop());
    await service.start();
    const delays = [60, 120, 240, 480, 900, 900, 900];
    for (const [index, seconds] of delays.entries()) {
        assert.equal(warnings[index].retrySeconds, seconds);
        context.mock.timers.tick(seconds * 1000 - 1);
        assert.equal(calls, index + 1);
        context.mock.timers.tick(1);
        await new Promise(setImmediate);
        assert.equal(calls, index + 2);
    }
    context.mock.timers.tick(86400000);
    await new Promise(setImmediate);
    assert.equal(calls, 8);
});

test('webhook retries respect Telegram retry_after and are cancelled when stopped', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const service = createTelegram({}, env, {
        async post() {
            calls++;
            return { data: { ok: false, parameters: { retry_after: 300 } } };
        },
    });
    context.after(() => service.stop());
    await service.start();
    context.mock.timers.tick(299999);
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    context.mock.timers.tick(1);
    await new Promise(setImmediate);
    assert.equal(calls, 2);
    service.stop();
    context.mock.timers.tick(86400000);
    await new Promise(setImmediate);
    assert.equal(calls, 2);
});

test('an in-flight failure cannot schedule retries after stop or interfere with a restarted worker', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    let rejectFirst;
    let calls = 0;
    const service = createTelegram({}, env, {
        async post() {
            calls++;
            if (calls === 1) {
                return new Promise((resolve, reject) => { rejectFirst = reject; });
            }
            return { data: { ok: true } };
        },
    });
    context.after(() => service.stop());
    const initial = service.start();
    service.stop();
    await service.start();
    rejectFirst(new Error('old failure'));
    await initial;
    context.mock.timers.tick(86400000);
    await new Promise(setImmediate);
    assert.equal(calls, 2);
});
