const crypto = require('node:crypto');
const axios = require('axios');
const log = require('./logger');

function createTelegramNotifications(repo, env = process.env, transport = axios) {
    const token = env.TELEGRAM_BOT_TOKEN || '';
    const username = env.TELEGRAM_BOT_USERNAME || '';
    const secret = env.TELEGRAM_WEBHOOK_SECRET || '';
    const ownerId = env.ADMIN_GITHUB_OWNER_ID || '';
    const origin = env.ADMIN_ORIGIN || '';
    const enabled = Boolean(repo && env.ADMIN_GITHUB_CLIENT_ID && env.ADMIN_GITHUB_CLIENT_SECRET &&
        /^[1-9][0-9]{0,19}$/.test(ownerId) && /^https:\/\/[^/]+$/.test(origin) &&
        /^[0-9]+:[A-Za-z0-9_-]{20,}$/.test(token) && /^[A-Za-z0-9_]{5,32}$/.test(username) &&
        /^[A-Za-z0-9_-]{32,256}$/.test(secret));
    let timer;
    let registrationTimer;
    let registrationGeneration = 0;
    let registrationDelay = 60000;
    let running = false;
    let pausedUntil = 0;

    function hash(value) {
        return crypto.createHash('sha256').update(value).digest('hex');
    }

    function authorized(value) {
        if (!enabled || typeof value !== 'string') {
            return false;
        }
        return crypto.timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(hash(secret), 'hex'));
    }

    async function status(id) {
        return { available: enabled, ...(repo && id ? await repo.status(id) : { connected: false, pending: false }) };
    }

    async function link(id) {
        const code = crypto.randomBytes(32).toString('base64url');
        if (!(await repo.link(id, hash(code), ownerId))) {
            return null;
        }
        return { url: `https://t.me/${username}?start=${code}`, expiresIn: 300 };
    }

    async function update(body) {
        const message = body?.message;
        if (message?.chat?.type !== 'private' || !Number.isSafeInteger(message.chat.id) || message.chat.id <= 0 ||
            message.from?.id !== message.chat.id || typeof message.text !== 'string') {
            return;
        }
        const chatId = String(message.chat.id);
        if (message.text === '/stop') {
            await repo.stop(chatId);
            log.info('TelegramStop: subscription disabled.');
            return;
        }
        const match = message.text.match(/^\/start ([A-Za-z0-9_-]{43})$/);
        if (!match) {
            return;
        }
        try {
            const connected = await repo.connect(hash(match[1]), chatId, ownerId);
            log.info('TelegramConnect: link accepted {accepted}.', { accepted: connected });
            if (connected) {
                return {
                    method: 'sendMessage',
                    chat_id: chatId,
                    text: 'Telegram ist verbunden. Du erhältst ab jetzt Benachrichtigungen über neue Icon-Meldungen. Mit /stop kannst du sie jederzeit abschalten.',
                };
            }
        } catch (error) {
            // A Telegram chat can belong to only one account. Do not expose SQL values.
            if (error.code === 'ER_DUP_ENTRY') {
                log.warn('TelegramConnect: chat already linked.');
                return;
            }
            throw error;
        }
    }

    async function flush() {
        if (!enabled || running || Date.now() < pausedUntil) {
            return;
        }
        running = true;
        try {
            const recipients = await repo.recipients(ownerId);
            for (const recipient of recipients.slice(0, 10)) {
                const count = await repo.claim(recipient.github_id, recipient.chat_id, ownerId);
                if (!count || !(await repo.connected(recipient.github_id, recipient.chat_id, ownerId))) {
                    continue;
                }
                try {
                    const response = await transport.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                        chat_id: recipient.chat_id,
                        text: `${count} neue Icon-Meldung(en) seit der letzten Benachrichtigung.\nIn der Admin-UI prüfen: ${origin}/admin/`,
                        link_preview_options: { is_disabled: true },
                    }, { timeout: 5000, maxContentLength: 16384, maxBodyLength: 16384, maxRedirects: 0 });
                    if (response.data?.ok !== true) {
                        throw new Error('Telegram rejected message');
                    }
                    log.info('TelegramNotify: digest sent for account {githubId}, reports {count}.', {
                        githubId: recipient.github_id, count,
                    });
                } catch (error) {
                    const status = error.response?.status;
                    log.warn('TelegramNotify: delivery failed for account {githubId}, status {status}.', {
                        githubId: recipient.github_id,
                        status: Number.isInteger(status) ? status : 'UNKNOWN',
                    });
                    if (status === 403) {
                        await repo.stop(recipient.chat_id);
                    }
                    if (status === 429) {
                        const delay = Number(error.response?.data?.parameters?.retry_after);
                        pausedUntil = Date.now() + Math.min(86400, Math.max(60, Number.isFinite(delay) ? delay : 60)) * 1000;
                        break;
                    }
                }
            }
        } catch (error) {
            // Axios and database errors may embed secrets and bound values.
            log.error('TelegramNotify: batch failed; details suppressed.');
        } finally {
            running = false;
        }
    }

    function scheduleRegistration(generation, error) {
        if (!timer || generation !== registrationGeneration) {
            return;
        }
        let delay = registrationDelay;
        const retryAfter = Number(error.response?.data?.parameters?.retry_after);
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
            delay = Math.max(delay, Math.min(retryAfter, 86400) * 1000);
        }
        registrationDelay = Math.min(registrationDelay * 2, 15 * 60000);
        log.warn('TelegramWebhook: automatic registration failed; retry in {retrySeconds} seconds.', {
            retrySeconds: Math.ceil(delay / 1000),
        });
        registrationTimer = setTimeout(function retryRegistration() {
            registrationTimer = null;
            void registerWebhook(generation);
        }, delay);
        registrationTimer.unref();
    }

    async function registerWebhook(generation) {
        try {
            const response = await transport.post(`https://api.telegram.org/bot${token}/setWebhook`, {
                url: `${origin}/api/telegram/webhook`,
                secret_token: secret,
                allowed_updates: ['message'],
                max_connections: 1,
                drop_pending_updates: false,
            }, { timeout: 5000, maxContentLength: 16384, maxBodyLength: 16384, maxRedirects: 0 });
            if (response.data?.ok !== true) {
                const error = new Error('Telegram rejected webhook registration');
                error.response = response;
                throw error;
            }
            if (generation === registrationGeneration && timer) {
                registrationDelay = 60000;
                log.info('TelegramWebhook: registered automatically.');
            }
        } catch (error) {
            // Upstream errors can include the bot URL and webhook secret.
            scheduleRegistration(generation, error);
        }
    }

    async function start() {
        if (enabled && !timer) {
            timer = setInterval(flush, 60000);
            timer.unref();
            log.info('TelegramNotify: worker started; batch size 10, interval 60 seconds.');
            registrationDelay = 60000;
            registrationGeneration++;
            await registerWebhook(registrationGeneration);
        } else if (!enabled && (token || username || secret)) {
            log.warn('TelegramNotify: disabled; check Telegram and GitHub configuration.');
        }
    }

    function stop() {
        clearInterval(timer);
        clearTimeout(registrationTimer);
        timer = null;
        registrationTimer = null;
        registrationGeneration++;
    }

    async function disconnect(id) {
        await repo.disconnect(id);
    }

    return { enabled, authorized, status, link, update, flush, start, stop, disconnect };
}

module.exports = createTelegramNotifications;
