const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validBitmap, validTelemetry } = require('../libs/validation');

const bitmap = { name: 'Test', userName: 'User', sizeX: 2, sizeY: 1, animated: false, rgb565array: '[0,65535]' };
const telemetry = { uuid: 'a'.repeat(40), version: '3.3.3', type: 'esp32', matrix: { type: 1, name: 'Column major', width: 32, height: 8 }, sensors: ['BH1750'] };

test('accepts static bitmaps and the existing comma-separated animation format', () => {
    assert.equal(validBitmap(bitmap), true);
    assert.equal(validBitmap({ ...bitmap, animated: true, rgb565array: '[0,65535],[1,2]' }), true);
});

test('rejects invalid bitmap shapes, dimensions, pixel values and field types', () => {
    for (const patch of [
        { name: '' }, { userName: {} }, { sizeX: 0 }, { sizeY: '1' }, { sizeX: 257 },
        { animated: 1 }, { rgb565array: [0, 1] }, { rgb565array: '[0]' },
        { rgb565array: '[0,65536]' }, { rgb565array: '[-1,0]' }, { rgb565array: '[1.5,0]' },
        { rgb565array: '[true,0]' }, { rgb565array: 'invalid' },
        { animated: true, rgb565array: '' }, { animated: true, rgb565array: '[0,1],[2]' },
    ]) assert.equal(validBitmap({ ...bitmap, ...patch }), false, JSON.stringify(patch));
    for (const body of [null, [], {}, '']) assert.equal(validBitmap(body), false);
});

test('accepts firmware telemetry, including older clients without buildSection', () => {
    assert.equal(validTelemetry(telemetry), true);
    assert.equal(validTelemetry({ ...telemetry, buildSection: 'wemos_d1_mini32' }), true);
    assert.equal(validTelemetry({ ...telemetry, sensors: [] }), true);
});

test('rejects malformed telemetry before it reaches the database', () => {
    for (const patch of [
        { uuid: 'x'.repeat(40) }, { uuid: Array(40).fill('a') }, { version: null },
        { type: {} }, { buildSection: 42 }, { matrix: {} },
        { matrix: { ...telemetry.matrix, width: -1 } }, { sensors: 'BH1750' }, { sensors: [{}] },
    ]) assert.equal(validTelemetry({ ...telemetry, ...patch }), false, JSON.stringify(patch));
    for (const body of [null, [], {}]) assert.equal(validTelemetry(body), false);
});
