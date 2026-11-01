const log = require('../libs/logger');
const tools = require('../libs/tools');
const asyncRoute = require('../libs/asyncRoute');
const repo = require('../libs/pixelItRepo');
const geoip = require('fast-geoip');
const { validTelemetry } = require('../libs/validation');
const { telemetryLimiter } = require('../libs/rateLimit');

function registerTelemetryRoutes(app) {
    app.post('/api/Telemetry', telemetryLimiter, asyncRoute(saveTelemetry));
}

async function saveTelemetry(req, res, next) {
    if (!validTelemetry(req.body)) {
        return res.status(400).send('Not valid body');
    }
    try {
        const telemetry = { ...req.body, geoip: await geoip.lookup(tools.getIPFromRequest(req)) };
        await repo.saveTelemetry(telemetry);
        log.info('{apiPath}: Successfully saved', {
            apiPath: 'Telemetry',
            uuid: telemetry.uuid,
            sourceIP: tools.getIPFromRequest(req),
            client: tools.getClientFromRequest(req),
            rateLimit: req.rateLimit,
        });
        res.sendStatus(200);
    } catch (error) {
        next(error);
    }
}

module.exports = registerTelemetryRoutes;
