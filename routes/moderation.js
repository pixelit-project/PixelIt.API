const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const log = require('../libs/logger');
const tools = require('../libs/tools');
const createCredentials = require('../libs/adminCredentials');
const { reportLimiter, adminLoginLimiter, adminReadLimiter, adminActionLimiter } = require('../libs/rateLimit');

function registerModerationRoutes(app, repo, cache, statisticsRepo = require('../libs/pixelItRepo')) {
    const sessions = new Map();
    const sessionLifetime = 30 * 60 * 1000;
    const maximumSessions = 100;
    const cookieName = '__Host-pixelit_admin';
    const origin = process.env.ADMIN_ORIGIN || '';
    const credentials = initializeCredentials();
    let statisticsRequest;

    async function initializeCredentials() {
        try {
            const verifyPassword = await createCredentials({
                ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
                ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
            });
            if (!verifyPassword || !/^https:\/\/[^/]+$/.test(origin)) {
                log.warn('Admin access disabled: configure a valid ADMIN_PASSWORD and HTTPS ADMIN_ORIGIN.');
            } else {
                log.info('Admin access configured; session lifetime: {sessionMinutes} minutes.', {
                    sessionMinutes: sessionLifetime / 60000,
                });
            }
            return verifyPassword;
        } catch (error) {
            log.error('Admin credential initialization failed: {errorCode}', { errorCode: getErrorCode(error) });
            return null;
        }
    }

    function getRequestContext(req) {
        return {
            sourceIP: tools.getIPFromRequest(req),
            useragent: req.useragent,
            rateLimit: req.rateLimit,
        };
    }

    function getErrorCode(error) {
        return typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNKNOWN';
    }

    function handleRequestError(error, req, next, operation) {
        log.error('{operation}: request failed ({errorCode})', {
            ...getRequestContext(req),
            operation,
            errorCode: getErrorCode(error),
        });
        // Database errors can include bound SQL values. Never forward those to logging middleware.
        next(new Error(`${operation} failed`));
    }

    function getSessionToken(req) {
        const cookie = req.headers.cookie || '';
        const match = cookie.match(/(?:^|;\s*)__Host-pixelit_admin=([a-f0-9]{64})(?:;|$)/);
        return match ? match[1] : null;
    }

    function removeExpiredSessions() {
        const now = Date.now();
        for (const [token, expiresAt] of sessions) {
            if (expiresAt <= now) {
                sessions.delete(token);
            }
        }
    }

    async function checkAdminOrigin(req, res, next) {
        res.set('Cache-Control', 'no-store');
        const verifyPassword = await credentials;
        if (!verifyPassword || !/^https:\/\/[^/]+$/.test(origin)) {
            res.sendStatus(503);
            return;
        }
        if (req.method !== 'GET' && req.get('Origin') !== origin) {
            log.warn('Admin request rejected: origin check failed.', getRequestContext(req));
            res.sendStatus(403);
            return;
        }
        next();
    }

    function requireAdminSession(req, res, next) {
        const token = getSessionToken(req);
        const expiresAt = sessions.get(token);
        if (!expiresAt || expiresAt <= Date.now()) {
            sessions.delete(token);
            log.warn('Admin request rejected: session missing or expired.', getRequestContext(req));
            res.sendStatus(401);
            return;
        }
        next();
    }

    function sendAdminPage(req, res) {
        const expiresAt = sessions.get(getSessionToken(req));
        const authenticated = expiresAt && expiresAt > Date.now();
        const fileName = authenticated ? 'admin.html' : 'admin-login.html';
        res.set('Vary', 'Cookie');
        res.type('html').send(fs.readFileSync(path.join(__dirname, '..', 'libs', fileName), 'utf8'));
    }

    function sendAdminScript(req, res) {
        res.type('js').send(fs.readFileSync(path.join(__dirname, '..', 'libs', 'admin-client.js'), 'utf8'));
    }

    function sendLoginScript(req, res) {
        res.type('js').send(fs.readFileSync(path.join(__dirname, '..', 'libs', 'admin-login.js'), 'utf8'));
    }

    function sendAdminStyles(req, res) {
        res.type('css').send(fs.readFileSync(path.join(__dirname, '..', 'libs', 'admin.css'), 'utf8'));
    }

    async function createReport(req, res, next) {
        const { iconId, reason } = req.body || {};
        const validIconId = Number.isSafeInteger(iconId) && iconId > 0;
        const validReason = typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 1000;
        if (!validIconId || !validReason) {
            log.warn('CreateReport: invalid request body.', getRequestContext(req));
            res.sendStatus(400);
            return;
        }
        try {
            const iconExists = await repo.report(iconId, reason.trim());
            if (!iconExists) {
                log.warn('CreateReport: icon {iconId} not found.', { ...getRequestContext(req), iconId });
                res.sendStatus(404);
                return;
            }
            log.info('CreateReport: report accepted for icon {iconId}.', { ...getRequestContext(req), iconId });
            res.sendStatus(202);
        } catch (error) {
            handleRequestError(error, req, next, 'CreateReport');
        }
    }

    async function login(req, res, next) {
        const password = req.body?.password;
        if (typeof password !== 'string' || password.length > 1024) {
            log.warn('AdminLogin: invalid request body.', getRequestContext(req));
            res.sendStatus(400);
            return;
        }
        try {
            const verifyPassword = await credentials;
            if (!verifyPassword || !(await verifyPassword(password))) {
                log.warn('AdminLogin: authentication failed.', getRequestContext(req));
                res.sendStatus(401);
                return;
            }
            removeExpiredSessions();
            // Replace this browser's old session before checking the capacity.
            sessions.delete(getSessionToken(req));
            if (sessions.size >= maximumSessions) {
                log.warn('AdminLogin: active session limit reached.', getRequestContext(req));
                res.sendStatus(503);
                return;
            }
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, Date.now() + sessionLifetime);
            res.set(
                'Set-Cookie',
                `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${sessionLifetime / 1000}`
            );
            log.info('AdminLogin: administrator signed in.', getRequestContext(req));
            res.sendStatus(204);
        } catch (error) {
            handleRequestError(error, req, next, 'AdminLogin');
        }
    }

    function logout(req, res) {
        sessions.delete(getSessionToken(req));
        res.set('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
        log.info('AdminLogout: administrator signed out.', getRequestContext(req));
        res.sendStatus(204);
    }

    async function getIconPreview(req, res, next) {
        const iconId = Number(req.params.id);
        if (!Number.isSafeInteger(iconId) || iconId < 1) {
            log.warn('AdminIconPreview: invalid icon ID.', getRequestContext(req));
            res.sendStatus(400);
            return;
        }
        try {
            const icon = await repo.preview(iconId);
            if (!icon) {
                log.warn('AdminIconPreview: icon {iconId} not found.', { ...getRequestContext(req), iconId });
                res.sendStatus(404);
                return;
            }
            log.info('AdminIconPreview: icon {iconId} delivered.', { ...getRequestContext(req), iconId });
            res.json(icon);
        } catch (error) {
            handleRequestError(error, req, next, 'AdminIconPreview');
        }
    }

    async function getReports(req, res, next) {
        const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : Number(req.query.before);
        if (!Number.isSafeInteger(before) || before < 1) {
            log.warn('AdminReports: invalid pagination cursor.', getRequestContext(req));
            res.sendStatus(400);
            return;
        }
        try {
            const reports = await repo.list(before);
            log.info('AdminReports: {count} reports delivered.', { ...getRequestContext(req), count: reports.length });
            res.json(reports);
        } catch (error) {
            handleRequestError(error, req, next, 'AdminReports');
        }
    }

    function loadStatistics() {
        if (!statisticsRequest) {
            statisticsRequest = statisticsRepo.getAdminStatistics().finally(() => {
                statisticsRequest = null;
            });
        }
        return statisticsRequest;
    }

    async function getStatistics(req, res, next) {
        try {
            const statistics = await cache.getOrSet('AdminStatistics', loadStatistics, 60);
            log.info('AdminStatistics: aggregated telemetry delivered; {activeDevices} active devices in 30 days.', {
                ...getRequestContext(req),
                activeDevices: statistics.active30d,
            });
            res.json(statistics);
        } catch (error) {
            handleRequestError(error, req, next, 'AdminStatistics');
        }
    }

    async function decideReport(req, res, next) {
        const reportId = Number(req.params.id);
        const action = req.params.action;
        const validAction = ['approve', 'reject', 'restore'].includes(action);
        if (!Number.isSafeInteger(reportId) || reportId < 1 || !validAction) {
            log.warn('AdminDecision: invalid report ID or action.', getRequestContext(req));
            res.sendStatus(400);
            return;
        }
        try {
            const updated = await repo.decide(reportId, action);
            if (!updated) {
                log.warn('AdminDecision: report {reportId}, action {action} rejected due to state conflict.', {
                    ...getRequestContext(req),
                    reportId,
                    action,
                });
                res.sendStatus(409);
                return;
            }
            cache.invalidateBitmaps();
            log.info('AdminDecision: report {reportId}, action {action} committed; bitmap caches invalidated.', {
                ...getRequestContext(req),
                reportId,
                action,
                actor: 'admin',
            });
            res.sendStatus(204);
        } catch (error) {
            handleRequestError(error, req, next, 'AdminDecision');
        }
    }

    // Public reporting is limited independently from uploads and administrator access.
    app.get(/^\/admin$/, (req, res) => res.redirect('/admin/'));
    app.get('/admin/', checkAdminOrigin, sendAdminPage);
    app.get('/admin/app.js', checkAdminOrigin, requireAdminSession, sendAdminScript);
    app.get('/admin/login.js', checkAdminOrigin, sendLoginScript);
    app.get('/admin/style.css', checkAdminOrigin, sendAdminStyles);
    app.post('/api/reports', reportLimiter, createReport);

    // Login is limited before origin/session checks, so rejected attempts count too.
    app.post('/api/admin/login', adminLoginLimiter, checkAdminOrigin, login);
    app.use('/api/admin', checkAdminOrigin, requireAdminSession);
    app.get('/api/admin/icons/:id', adminReadLimiter, getIconPreview);
    app.get('/api/admin/reports', adminReadLimiter, getReports);
    app.get('/api/admin/statistics', adminReadLimiter, getStatistics);
    app.post('/api/admin/logout', adminActionLimiter, logout);
    app.post('/api/admin/reports/:id/:action', adminActionLimiter, decideReport);
}

module.exports = registerModerationRoutes;
