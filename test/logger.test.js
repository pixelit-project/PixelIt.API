const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

test('Seq ES module initialization preserves logs emitted immediately after startup', async t => {
    t.mock.method(console, 'log', () => {});
    const events = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            events.push({ path: req.url, key: req.headers['x-seq-apikey'], body: JSON.parse(body) });
            res.writeHead(201).end();
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const previousServer = process.env.SEQ_SERVER;
    const previousKey = process.env.SEQ_APIKEY;
    process.env.SEQ_SERVER = `http://127.0.0.1:${server.address().port}`;
    process.env.SEQ_APIKEY = 'test-key';
    delete require.cache[require.resolve('../libs/logger')];
    try {
        const log = require('../libs/logger');
        log.info('Started {name}', { name: 'API' });
        await log.close();
        assert.equal(events.length, 1);
        assert.equal(events[0].path, '/api/events/raw');
        assert.equal(events[0].key, 'test-key');
        assert.equal(events[0].body.Events[0].MessageTemplate, 'Started {name}');
        assert.equal(events[0].body.Events[0].Properties.Application, 'PixelIt.api');
    } finally {
        if (previousServer === undefined) delete process.env.SEQ_SERVER;
        else process.env.SEQ_SERVER = previousServer;
        if (previousKey === undefined) delete process.env.SEQ_APIKEY;
        else process.env.SEQ_APIKEY = previousKey;
        await new Promise(resolve => server.close(resolve));
    }
});
