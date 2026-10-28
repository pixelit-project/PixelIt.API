const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function stub(moduleName, exports) {
    require.cache[require.resolve(moduleName)] = { id: require.resolve(moduleName), filename: require.resolve(moduleName), loaded: true, exports };
}
const noop = () => {};
stub('../libs/logger', { info: noop, warn: noop, error: noop });
let save = async () => {};
let saves = 0;
let lookups = 0;
stub('../libs/pixelItRepo', {
    saveBMP: async body => { saves++; await save(body); },
    saveTelemetry: async body => { saves++; await save(body); },
});
stub('fast-geoip', { lookup: async () => { lookups++; return null; } });
process.env.API_GLOBAL_LIMIT_MAX = '1000';
process.env.API_SAVEBITMAP_LIMIT_MAX = '1000';
process.env.API_TELEMETRY_LIMIT_MAX = '1000';
delete process.env.TRUSTED_PROXIES;
const app = require('../main');
const server = app.listen(0, '127.0.0.1');
const ready = new Promise(resolve => server.once('listening', resolve));
after(() => new Promise(resolve => server.close(resolve)));

async function request(path, body, headers = {}) {
    await ready;
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => {
            let text = '';
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, text }));
        });
        req.on('error', reject);
        req.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
}
const bitmap = { name: 'Test', userName: 'User', sizeX: 1, sizeY: 1, animated: false, rgb565array: '[65535]' };
const telemetry = { uuid: 'a'.repeat(40), version: '3.3.3', type: 'esp32', matrix: { type: 1, name: 'Column major', width: 32, height: 8 }, sensors: [] };

test('write endpoints validate input, wait for persistence, and report failures', async () => {
    for (const [path, body] of [['/api/SaveBitmap', bitmap], ['/api/Telemetry', telemetry]]) {
        const previousSaves = saves;
        const previousLookups = lookups;
        assert.equal((await request(path, {})).status, 400);
        assert.equal(saves, previousSaves);
        assert.equal(lookups, previousLookups);

        let release;
        let started;
        const entered = new Promise(resolve => { started = resolve; });
        save = async () => { started(); await new Promise(resolve => { release = resolve; }); };
        let settled = false;
        const pending = request(path, body).then(result => { settled = true; return result; });
        await entered;
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(settled, false, 'must not acknowledge an unfinished database write');
        release();
        assert.deepEqual(await pending, { status: 200, text: 'OK' });

        save = async () => { throw new Error('private database details'); };
        assert.deepEqual(await request(path, body), { status: 500, text: 'Internal server error' });
    }
});

test('malformed JSON and oversized requests return controlled client errors', async () => {
    assert.equal((await request('/api/SaveBitmap', '{')).status, 400);
    assert.equal((await request('/api/SaveBitmap', JSON.stringify({ data: 'x'.repeat(110000) }))).status, 413);
});

test('proxy configuration ignores untrusted forwarding headers and resolves trusted chains', async () => {
    const { getIPFromRequest } = require('../libs/tools');
    const previous = app.get('trust proxy');
    app.post('/test/ip', (req, res) => res.send(getIPFromRequest(req)));
    try {
        assert.equal((await request('/test/ip', {}, { 'X-Forwarded-For': '198.51.100.1' })).text, '127.0.0.1');
        app.set('trust proxy', ['loopback']);
        assert.equal((await request('/test/ip', {}, { 'X-Forwarded-For': '198.51.100.1' })).text, '198.51.100.1');
        assert.equal((await request('/test/ip', {}, { 'X-Forwarded-For': '192.0.2.99, 198.51.100.1' })).text, '198.51.100.1');
    } finally {
        app.set('trust proxy', previous);
    }
});

test('rate limiter blocks spoofed exclusions and IPv6 address rotation', async () => {
    process.env.API_GLOBAL_LIMIT_MAX = '2';
    process.env.API_GLOBAL_LIMIT_EXCLUDE = '198.51.100.1';
    delete require.cache[require.resolve('../libs/rateLimit')];
    const { apiLimiter } = require('../libs/rateLimit');
    app.post('/test/limited', apiLimiter, (req, res) => res.sendStatus(200));
    const previous = app.get('trust proxy');
    try {
        app.set('trust proxy', false);
        for (const status of [200, 200, 429]) {
            assert.equal((await request('/test/limited', {}, { 'X-Forwarded-For': '198.51.100.1' })).status, status);
        }
        app.set('trust proxy', ['loopback']);
        for (const [ip, status] of [
            ['2001:db8:1234:ab00::1', 200],
            ['2001:db8:1234:abff::2', 200],
            ['2001:db8:1234:ab12::3', 429],
            ['2001:db8:1234:ac00::1', 200],
        ]) assert.equal((await request('/test/limited', {}, { 'X-Forwarded-For': ip })).status, status);
        // An exact excluded client remains exempt when resolved through a trusted proxy.
        for (let i = 0; i < 3; i++) {
            assert.equal((await request('/test/limited', {}, { 'X-Forwarded-For': '198.51.100.1' })).status, 200);
        }
    } finally {
        app.set('trust proxy', previous);
    }
});
