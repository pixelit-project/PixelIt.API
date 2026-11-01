const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

// Derive once at startup; login attempts use the same salted, constant-time check.
async function createCredentials(env) {
    let salt;
    let expected;
    if (env.ADMIN_PASSWORD !== undefined) {
        const password = env.ADMIN_PASSWORD;
        if (typeof password !== 'string' || password.length < 16 || password.length > 1024) {
            return null;
        }
        salt = crypto.randomBytes(16).toString('hex');
        expected = await scrypt(env.ADMIN_PASSWORD, salt, 64);
    } else {
        const encoded = env.ADMIN_PASSWORD_HASH || '';
        if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded)) {
            return null;
        }
        const parts = encoded.split(':');
        salt = parts[1];
        expected = Buffer.from(parts[2], 'hex');
    }
    async function verifyPassword(password) {
        if (typeof password !== 'string' || password.length > 1024) {
            return false;
        }
        const derived = await scrypt(password, salt, 64);
        return crypto.timingSafeEqual(derived, expected);
    }

    return verifyPassword;
}

module.exports = createCredentials;
