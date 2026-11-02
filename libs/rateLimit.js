const rateLimit = require('express-rate-limit');
const log = require('./logger');
const tools = require('./tools');

let globelLimitExclude = [];
if (process.env.API_GLOBAL_LIMIT_EXCLUDE) {
    globelLimitExclude = process.env.API_GLOBAL_LIMIT_EXCLUDE.split(',').map(x => tools.normalizeIP(x.trim()));
}

let telemetryLimitExclude = [];
if (process.env.API_TELEMETRY_LIMIT_EXCLUDE) {
    telemetryLimitExclude = process.env.API_TELEMETRY_LIMIT_EXCLUDE.split(',').map(x => tools.normalizeIP(x.trim()));
}

let saveBitmapLimitExclude = [];
if (process.env.API_SAVEBITMAP_LIMIT_EXCLUDE) {
    saveBitmapLimitExclude = process.env.API_SAVEBITMAP_LIMIT_EXCLUDE.split(',').map(x => tools.normalizeIP(x.trim()));
}


const apiLimiter = rateLimit({
    windowMs: Number(process.env.API_GLOBAL_LIMIT_WINDOW_MS) || 5 * 60 * 1000,
    max: Number(process.env.API_GLOBAL_LIMIT_MAX) || 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getRateLimitKey(req),
    skip: (req, response) => globelLimitExclude.includes(tools.getIPFromRequest(req)),
    handler: (req, response, next, options) => {
        response.status(options.statusCode).send(options.message);
        const sourceIP = tools.getIPFromRequest(req);
        const rawUrl = req.path === '/api/admin/github/callback' || req.originalUrl?.startsWith('/api/admin/github/callback?')
            ? '/api/admin/github/callback' : tools.getRawURLFromRequest(req);
        log.warn('Global API RateLimit reached from: {sourceIP}, rawUrl: {rawUrl}', { sourceIP, rawUrl, useragent: req.useragent, });
    }
});

const telemetryLimiter = rateLimit({
    windowMs: Number(process.env.API_TELEMETRY_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.API_TELEMETRY_LIMIT_MAX) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getRateLimitKey(req),
    skip: (req, response) => telemetryLimitExclude.includes(tools.getIPFromRequest(req)),
    handler: (req, response, next, options) => {
        response.status(options.statusCode).send(options.message);
        const sourceIP = tools.getIPFromRequest(req);
        const rawUrl = req.path === '/api/admin/github/callback' || req.originalUrl?.startsWith('/api/admin/github/callback?')
            ? '/api/admin/github/callback' : tools.getRawURLFromRequest(req);
        log.warn('Telemetry API RateLimit reached from: {sourceIP}, rawUrl: {rawUrl}', { sourceIP, rawUrl, useragent: req.useragent, });
    }
});

const saveBitmapLimiter = rateLimit({
    windowMs: Number(process.env.API_SAVEBITMAP_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.API_SAVEBITMAP_LIMIT_MAX) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getRateLimitKey(req),
    skip: (req, response) => saveBitmapLimitExclude.includes(tools.getIPFromRequest(req)),
    handler: (req, response, next, options) => {
        response.status(options.statusCode).send(options.message);
        const sourceIP = tools.getIPFromRequest(req);
        const rawUrl = req.path === '/api/admin/github/callback' || req.originalUrl?.startsWith('/api/admin/github/callback?')
            ? '/api/admin/github/callback' : tools.getRawURLFromRequest(req);
        log.warn('SaveBitmap API RateLimit reached from: {sourceIP}, rawUrl: {rawUrl}', { sourceIP, rawUrl, useragent: req.useragent, });
    }
});

// Moderation limits deliberately have no IP exemptions, including for admin clients.
function getPositiveLimit(value, defaultValue) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : defaultValue;
}

const reportLimiter = rateLimit({
    windowMs: getPositiveLimit(process.env.API_REPORT_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: getPositiveLimit(process.env.API_REPORT_LIMIT_MAX, 5),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getRateLimitKey(req),
    handler: (req, response, next, options) => {
        response.status(options.statusCode).send(options.message);
        const sourceIP = tools.getIPFromRequest(req);
        log.warn('Report API RateLimit reached from: {sourceIP}', {
            sourceIP,
            useragent: req.useragent,
            rateLimit: req.rateLimit,
        });
    },
});

const adminLoginLimiter = rateLimit({
    windowMs: getPositiveLimit(process.env.API_ADMIN_LOGIN_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: getPositiveLimit(process.env.API_ADMIN_LOGIN_LIMIT_MAX, 5),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getRateLimitKey(req),
    handler: (req, response, next, options) => {
        response.status(options.statusCode).send(options.message);
        const sourceIP = tools.getIPFromRequest(req);
        log.warn('Admin login API RateLimit reached from: {sourceIP}', {
            sourceIP,
            useragent: req.useragent,
            rateLimit: req.rateLimit,
        });
    },
});

const adminReadLimiter = rateLimit({
    windowMs: getPositiveLimit(process.env.API_ADMIN_READ_LIMIT_WINDOW_MS, 5 * 60 * 1000),
    max: getPositiveLimit(process.env.API_ADMIN_READ_LIMIT_MAX, 60),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getRateLimitKey(req),
    handler: (req, response, next, options) => {
        response.status(options.statusCode).send(options.message);
        const sourceIP = tools.getIPFromRequest(req);
        log.warn('Admin read API RateLimit reached from: {sourceIP}', {
            sourceIP,
            useragent: req.useragent,
            rateLimit: req.rateLimit,
        });
    },
});

const adminActionLimiter = rateLimit({
    windowMs: getPositiveLimit(process.env.API_ADMIN_ACTION_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: getPositiveLimit(process.env.API_ADMIN_ACTION_LIMIT_MAX, 30),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getRateLimitKey(req),
    handler: (req, response, next, options) => {
        response.status(options.statusCode).send(options.message);
        const sourceIP = tools.getIPFromRequest(req);
        log.warn('Admin action API RateLimit reached from: {sourceIP}', {
            sourceIP,
            useragent: req.useragent,
            rateLimit: req.rateLimit,
        });
    },
});

const telegramWebhookLimiter = rateLimit({
    windowMs: getPositiveLimit(process.env.API_TELEGRAM_WEBHOOK_LIMIT_WINDOW_MS, 60000),
    max: getPositiveLimit(process.env.API_TELEGRAM_WEBHOOK_LIMIT_MAX, 120),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, response) => tools.getRateLimitKey(req),
    handler: (req, response, next, options) => {
        response.status(options.statusCode).send(options.message);
        log.warn('Telegram webhook RateLimit reached from: {sourceIP}', {
            sourceIP: tools.getIPFromRequest(req),
            rateLimit: req.rateLimit,
        });
    },
});

module.exports = {
    apiLimiter,
    telegramWebhookLimiter,
    telemetryLimiter,
    saveBitmapLimiter,
    reportLimiter,
    adminLoginLimiter,
    adminReadLimiter,
    adminActionLimiter,
};
