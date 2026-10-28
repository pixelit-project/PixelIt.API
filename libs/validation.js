const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max = 255) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isDimension = value => Number.isInteger(value) && value > 0 && value <= 256;

function validBitmap(body) {
    if (!isObject(body) || !isText(body.name) || !isText(body.userName) ||
        !isDimension(body.sizeX) || !isDimension(body.sizeY) ||
        typeof body.animated !== 'boolean' || typeof body.rgb565array !== 'string') return false;

    try {
        // Animated bitmaps use comma-separated frame arrays without an outer array.
        const pixels = JSON.parse(body.animated ? `[${body.rgb565array}]` : body.rgb565array);
        const frames = body.animated ? pixels : [pixels];
        return Array.isArray(frames) && frames.length > 0 && frames.every(frame =>
            Array.isArray(frame) && frame.length === body.sizeX * body.sizeY &&
            frame.every(pixel => Number.isInteger(pixel) && pixel >= 0 && pixel <= 65535));
    } catch {
        return false;
    }
}

function validTelemetry(body) {
    return isObject(body) && typeof body.uuid === 'string' && /^[a-f0-9]{40}$/i.test(body.uuid) &&
        isText(body.version) && isText(body.type) &&
        (body.buildSection === undefined || (typeof body.buildSection === 'string' && body.buildSection.length <= 255)) &&
        isObject(body.matrix) && isText(body.matrix.name) &&
        Number.isInteger(body.matrix.type) && body.matrix.type > 0 &&
        isDimension(body.matrix.width) && isDimension(body.matrix.height) &&
        Array.isArray(body.sensors) && body.sensors.length <= 32 && body.sensors.every(sensor => isText(sensor));
}

module.exports = { validBitmap, validTelemetry };
