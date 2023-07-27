const rateLimit = require('express-rate-limit');
const log = require('./logger');
const tools = require('./tools');

let globelLimitExclude = [];
if (process.env.API_GLOBAL_LIMIT_EXCLUDE) {
    globelLimitExclude = process.env.API_GLOBAL_LIMIT_EXCLUDE.split(',').map(x => x.trim());
}

let telemetryLimitExclude = [];
if (process.env.API_TELEMETRY_LIMIT_EXCLUDE) {
    telemetryLimitExclude = process.env.API_TELEMETRY_LIMIT_EXCLUDE.split(',').map(x => x.trim());
}


const apiLimiter = rateLimit({
    windowMs: Number(process.env.API_GLOBAL_LIMIT_WINDOW_MS) || 5 * 60 * 1000,
    max: Number(process.env.API_GLOBAL_LIMIT_MAX) || 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getIPFromRequest(req),
    skip: (req, response) => globelLimitExclude.includes(tools.getIPFromRequest(req)),
    onLimitReached: (req, response, next, options) => {
        const sourceIP = tools.getIPFromRequest(req);
        const rawUrl = tools.getRawURLFromRequest(req);
        log.warn('Global API RateLimit reached from: {sourceIP}, rawUrl: {rawUrl}', { sourceIP, rawUrl, useragent: req.useragent, });
    }
});

const telemetryLimiter = rateLimit({
    windowMs: Number(process.env.API_TELEMETRY_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.API_TELEMETRY_LIMIT_MAX) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getIPFromRequest(req),
    skip: (req, response) => telemetryLimitExclude.includes(tools.getIPFromRequest(req)),
    onLimitReached: (req, response, next, options) => {
        const sourceIP = tools.getIPFromRequest(req);
        const rawUrl = tools.getRawURLFromRequest(req);
        log.warn('Telemetry API RateLimit reached from: {sourceIP}, rawUrl: {rawUrl}', { sourceIP, rawUrl, useragent: req.useragent, });
    }
});

module.exports = {
    apiLimiter,
    telemetryLimiter,
}

