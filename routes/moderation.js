const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const log = require('../libs/logger');
const tools = require('../libs/tools');
const createTelegramNotifications = require('../libs/telegramNotifications');
const createGithubAuth = require('../libs/githubAuth');
const createCredentials = require('../libs/adminCredentials');
const { reportLimiter, adminLoginLimiter, adminReadLimiter, adminActionLimiter, telegramWebhookLimiter } = require('../libs/rateLimit');

function registerModerationRoutes(
    app,
    repo,
    cache,
    statisticsRepo = require('../libs/pixelItRepo'),
    github = createGithubAuth(process.env),
    telegram = createTelegramNotifications(repo.telegram)
) {
    const sessions = new Map();
    const pendingLogins = new Map();
    const sessionLifetime = 30 * 60 * 1000;
    const maximumSessions = 100;
    const cookieName = '__Host-pixelit_admin';
    const origin = process.env.ADMIN_ORIGIN || '';
    const credentials = initializeCredentials();
    let statisticsRequest;

    async function initializeCredentials() {
        try {
            const verifyPassword = github.configured ? null : await createCredentials({
                ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
                ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
            });
            if ((github.configured ? !github.enabled : !verifyPassword) || !/^https:\/\/[^/]+$/.test(origin)) {
                log.warn('Admin access disabled: configure valid authentication and HTTPS ADMIN_ORIGIN.');
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
        for (const [token, session] of sessions) {
            if (session.expiresAt <= now) {
                sessions.delete(token);
            }
        }
    }

    async function checkAdminOrigin(req, res, next) {
        res.set('Cache-Control', 'no-store');
        const verifyPassword = await credentials;
        if ((github.configured ? !github.enabled : !verifyPassword) || !/^https:\/\/[^/]+$/.test(origin)) {
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

    async function requireAdminSession(req, res, next) {
        const token = getSessionToken(req);
        const session = sessions.get(token);
        if (!session || session.expiresAt <= Date.now()) {
            sessions.delete(token);
            log.warn('Admin request rejected: session missing or expired.', getRequestContext(req));
            res.sendStatus(401);
            return;
        }
        try {
            req.admin = session;
            if (req.admin.id && req.admin.id !== github.ownerId && !(await repo.isModerator(req.admin.id))) {
                sessions.delete(token);
                res.sendStatus(401);
                return;
            }
            next();
        } catch (error) {
            handleRequestError(error, req, next, 'AdminSession');
        }
    }

    function sendAdminPage(req, res) {
        const session = sessions.get(getSessionToken(req));
        const authenticated = session && session.expiresAt > Date.now();
        const fileName = authenticated ? 'admin.html' : 'admin-login.html';
        res.set('Vary', 'Cookie');
        res.type('html').send(fs.readFileSync(path.join(__dirname, '..', 'libs', fileName), 'utf8')
            .replace('<!-- GITHUB_LOGIN -->', github.enabled ? '<a class="primary github-login" href="/api/admin/github/login">Sign in with GitHub</a>' : '')
            .replace('<!-- PASSWORD_HIDDEN -->', github.configured ? 'hidden' : ''));
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
        if (github.configured) {
            res.sendStatus(404);
            return;
        }
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
            sessions.set(token, { expiresAt: Date.now() + sessionLifetime, role: 'admin', actor: 'admin' });
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
            const updated = await repo.decide(reportId, action, req.admin.actor, req.admin.login || null);
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
                actor: req.admin.actor,
            });
            res.sendStatus(204);
        } catch (error) {
            handleRequestError(error, req, next, 'AdminDecision');
        }
    }

    function githubLogin(req, res) {
        if (!github.enabled) {
            res.sendStatus(503);
            return;
        }
        for (const [key, value] of pendingLogins) {
            if (value.expiresAt <= Date.now()) {
                pendingLogins.delete(key);
            }
        }
        if (pendingLogins.size >= 100) {
            res.sendStatus(503);
            return;
        }
        const state = crypto.randomBytes(32).toString('hex');
        const verifier = crypto.randomBytes(32).toString('base64url');
        pendingLogins.set(state, { verifier, expiresAt: Date.now() + 5 * 60 * 1000 });
        res.cookie('__Host-pixelit_oauth', state, {
            httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 300000,
        });
        res.redirect(github.authorize(state, crypto.createHash('sha256').update(verifier).digest('base64url')));
    }

    async function githubCallback(req, res, next) {
        const state = req.query.state;
        const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)__Host-pixelit_oauth=([a-f0-9]{64})(?:;|$)/);
        const pending = typeof state === 'string' ? pendingLogins.get(state) : null;
        if (!github.enabled || !pending || !cookie || cookie[1] !== state || pending.expiresAt <= Date.now()) {
            log.warn('GitHubLogin: invalid or expired state.', getRequestContext(req));
            res.sendStatus(403);
            return;
        }
        pendingLogins.delete(state);
        res.clearCookie('__Host-pixelit_oauth', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
        if (typeof req.query.code !== 'string' || req.query.code.length > 512) {
            res.status(400).send('Sign-in cancelled. Please open /admin/ again.');
            return;
        }
        try {
            const user = await github.identify(req.query.code, pending.verifier);
            const role = user.id === github.ownerId ? 'admin' : 'moderator';
            if (role !== 'admin' && !(await repo.isModerator(user.id))) {
                log.warn('GitHubLogin: account {githubId} denied.', { ...getRequestContext(req), githubId: user.id });
                res.status(403).send('This GitHub account does not have access.');
                return;
            }
            await repo.rememberIdentity(user.id, user.login);
            removeExpiredSessions();
            sessions.delete(getSessionToken(req));
            if (sessions.size >= maximumSessions) {
                res.sendStatus(503);
                return;
            }
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, { ...user, role, actor: `github:${user.id}`, expiresAt: Date.now() + sessionLifetime });
            res.cookie(cookieName, token, {
                httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: sessionLifetime,
            });
            log.info('GitHubLogin: account {githubId} signed in as {role}.', {
                ...getRequestContext(req), githubId: user.id, role,
            });
            res.redirect('/admin/');
        } catch (error) {
            handleRequestError(error, req, next, 'GitHubLogin');
        }
    }

    function requireOwner(req, res, next) {
        if (req.admin.role !== 'admin') {
            log.warn('ModeratorManagement: access denied.', { ...getRequestContext(req), actor: req.admin.actor });
            res.sendStatus(403);
            return;
        }
        next();
    }

    async function getModerators(req, res, next) {
        try {
            res.json(await repo.listModerators());
        } catch (error) {
            handleRequestError(error, req, next, 'ListModerators');
        }
    }

    async function updateModerator(req, res, next) {
        const { githubId: suppliedId, githubLogin, enabled } = req.body || {};
        let githubId = suppliedId;
        let login = null;
        const hasLogin = githubLogin !== undefined;
        const validLogin = typeof githubLogin === 'string' && /^@?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(githubLogin);
        const validId = typeof githubId === 'string' && /^[1-9][0-9]{0,19}$/.test(githubId);
        if (typeof enabled !== 'boolean' || (hasLogin ? !validLogin || suppliedId !== undefined : !validId)) {
            log.warn('ModeratorManagement: invalid request.', getRequestContext(req));
            res.sendStatus(400);
            return;
        }
        try {
            if (hasLogin) {
                let user;
                try {
                    user = await github.lookupUser(githubLogin.replace(/^@/, ''));
                } catch (error) {
                    log.warn('ModeratorManagement: GitHub lookup unavailable.', getRequestContext(req));
                    res.sendStatus(503);
                    return;
                }
                if (!user) {
                    res.sendStatus(404);
                    return;
                }
                githubId = user.id;
                login = user.login;
            }
            if (githubId === github.ownerId) {
                log.warn('ModeratorManagement: owner modification rejected.', getRequestContext(req));
                res.sendStatus(400);
                return;
            }
            if (!(await repo.setModerator(githubId, enabled, req.admin.actor, login, req.admin.login || null))) {
                res.sendStatus(409);
                return;
            }
            // Removal revokes this process's sessions immediately; other processes recheck membership.
            if (!enabled) {
                for (const [token, session] of sessions) {
                    if (session.id === githubId) {
                        sessions.delete(token);
                    }
                }
            }
            log.info('ModeratorManagement: account {githubId}, enabled {enabled}, actor {actor}.', {
                ...getRequestContext(req), githubId, enabled, actor: req.admin.actor,
            });
            res.sendStatus(204);
        } catch (error) {
            handleRequestError(error, req, next, 'UpdateModerator');
        }
    }

    async function getAudit(req, res, next, kind) {
        const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : Number(req.query.before);
        if (!Number.isSafeInteger(before) || before < 1) {
            log.warn('AdminAudit: invalid pagination cursor.', getRequestContext(req));
            res.sendStatus(400);
            return;
        }
        try {
            const entries = kind === 'admin'
                ? await repo.listAdminAudit(before)
                : await repo.listModerationAudit(before);
            log.info('AdminAudit: {kind} log delivered, entries {count}.', {
                ...getRequestContext(req), kind, count: entries.length, actor: req.admin.actor,
            });
            res.json(entries);
        } catch (error) {
            handleRequestError(error, req, next, 'AdminAudit');
        }
    }

    function requireTelegramAccount(req, res, next) {
        if (!req.admin.id) {
            res.sendStatus(503);
            return;
        }
        next();
    }

    async function telegramStatus(req, res, next) {
        try {
            res.json(await telegram.status(req.admin.id));
        } catch (error) {
            handleRequestError(error, req, next, 'TelegramStatus');
        }
    }

    async function telegramLink(req, res, next) {
        if (!telegram.enabled) {
            res.sendStatus(503);
            return;
        }
        try {
            const link = await telegram.link(req.admin.id);
            if (!link) {
                res.sendStatus(403);
                return;
            }
            log.info('TelegramLink: account {githubId} requested link.', {
                ...getRequestContext(req), githubId: req.admin.id,
            });
            res.json(link);
        } catch (error) {
            handleRequestError(error, req, next, 'TelegramLink');
        }
    }

    async function telegramDisconnect(req, res, next) {
        try {
            await telegram.disconnect(req.admin.id);
            log.info('TelegramDisconnect: account {githubId} disconnected.', {
                ...getRequestContext(req), githubId: req.admin.id,
            });
            res.sendStatus(204);
        } catch (error) {
            handleRequestError(error, req, next, 'TelegramDisconnect');
        }
    }

    async function telegramWebhook(req, res, next) {
        res.set('Cache-Control', 'no-store');
        if (!telegram.authorized(req.get('X-Telegram-Bot-Api-Secret-Token'))) {
            log.warn('TelegramWebhook: authentication failed.', getRequestContext(req));
            res.sendStatus(403);
            return;
        }
        try {
            const reply = await telegram.update(req.body);
            if (reply) {
                res.json(reply);
            } else {
                res.sendStatus(204);
            }
        } catch (error) {
            handleRequestError(error, req, next, 'TelegramWebhook');
        }
    }

    // Public reporting is limited independently from uploads and administrator access.
    app.get(/^\/admin$/, (req, res) => res.redirect('/admin/'));
    app.get('/admin/', checkAdminOrigin, sendAdminPage);
    app.get('/admin/app.js', checkAdminOrigin, requireAdminSession, sendAdminScript);
    app.get('/admin/login.js', checkAdminOrigin, sendLoginScript);
    app.get('/admin/style.css', checkAdminOrigin, sendAdminStyles);
    app.post('/api/telegram/webhook', telegramWebhookLimiter, telegramWebhook);
    app.post('/api/reports', reportLimiter, createReport);

    // Login is limited before origin/session checks, so rejected attempts count too.
    app.post('/api/admin/login', adminLoginLimiter, checkAdminOrigin, login);
    app.get('/api/admin/github/login', adminLoginLimiter, checkAdminOrigin, githubLogin);
    app.get('/api/admin/github/callback', adminLoginLimiter, checkAdminOrigin, githubCallback);
    app.use('/api/admin', checkAdminOrigin, requireAdminSession);
    app.get('/api/admin/me', adminReadLimiter, (req, res) => res.json({ role: req.admin.role, login: req.admin.login || 'Administrator', id: req.admin.id || null }));
    app.get('/api/admin/telegram', adminReadLimiter, telegramStatus);
    app.post('/api/admin/telegram/link', adminActionLimiter, requireTelegramAccount, telegramLink);
    app.post('/api/admin/telegram/disconnect', adminActionLimiter, requireTelegramAccount, telegramDisconnect);
    app.get('/api/admin/audit/moderation', adminReadLimiter, (req, res, next) => getAudit(req, res, next, 'moderation'));
    app.get('/api/admin/audit/admin', adminReadLimiter, requireOwner, (req, res, next) => getAudit(req, res, next, 'admin'));
    app.get('/api/admin/moderators', adminReadLimiter, requireOwner, getModerators);
    app.post('/api/admin/moderators', adminActionLimiter, requireOwner, updateModerator);
    app.get('/api/admin/icons/:id', adminReadLimiter, getIconPreview);
    app.get('/api/admin/reports', adminReadLimiter, getReports);
    app.get('/api/admin/statistics', adminReadLimiter, getStatistics);
    app.post('/api/admin/logout', adminActionLimiter, logout);
    app.post('/api/admin/reports/:id/:action', adminActionLimiter, decideReport);
    return telegram;
}

module.exports = registerModerationRoutes;
