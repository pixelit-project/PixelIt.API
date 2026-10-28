const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getIPFromRequest, getRateLimitKey, normalizeIP } = require('../libs/tools');

test('uses Express resolved IP instead of trusting a raw forwarding header', () => {
    assert.equal(getIPFromRequest({ ip: '192.0.2.1', headers: { 'x-forwarded-for': '198.51.100.1' } }), '192.0.2.1');
});

test('normalizes IPv4-mapped IPv6 for rate limits and exact IP exclusions', () => {
    for (const ip of ['::ffff:192.0.2.1', '::ffff:c000:201', '0:0:0:0:0:ffff:c000:201']) {
        assert.equal(normalizeIP(ip), '192.0.2.1');
        assert.equal(getRateLimitKey({ ip }), '192.0.2.1');
    }
});

test('IPv6 address rotation within /56 shares a rate-limit key', () => {
    const key = getRateLimitKey({ ip: '2001:db8:1234:ab00::1' });
    assert.equal(key, getRateLimitKey({ ip: '2001:0db8:1234:abff:ffff:ffff:ffff:ffff' }));
    assert.notEqual(key, getRateLimitKey({ ip: '2001:db8:1234:ac00::1' }));
    assert.notEqual(getRateLimitKey({ ip: '192.0.2.1' }), getRateLimitKey({ ip: '192.0.2.2' }));
});
