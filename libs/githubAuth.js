const axios = require('axios');

function createGithubAuth(env) {
    const clientId = env.ADMIN_GITHUB_CLIENT_ID;
    const clientSecret = env.ADMIN_GITHUB_CLIENT_SECRET;
    const ownerId = env.ADMIN_GITHUB_OWNER_ID;
    const configured = Boolean(clientId || clientSecret || ownerId);
    const enabled = Boolean(clientId && clientSecret && /^[1-9][0-9]{0,19}$/.test(ownerId || ''));
    const callback = `${env.ADMIN_ORIGIN}/api/admin/github/callback`;

    function authorize(state, challenge) {
        const parameters = new URLSearchParams({
            client_id: clientId,
            redirect_uri: callback,
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256',
        });
        return `https://github.com/login/oauth/authorize?${parameters}`;
    }

    async function identify(code, verifier) {
        const options = { timeout: 10000, maxContentLength: 32768, maxBodyLength: 32768, maxRedirects: 0 };
        const response = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: callback,
            code,
            code_verifier: verifier,
        }, { ...options, headers: { Accept: 'application/json' } });
        const token = response.data.access_token;
        if (typeof token !== 'string' || token.length > 4096) {
            throw new Error('GitHub authentication failed');
        }
        const user = await axios.get('https://api.github.com/user', {
            ...options,
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        });
        if (!Number.isSafeInteger(user.data.id) || user.data.id < 1 ||
            typeof user.data.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(user.data.login)) {
            throw new Error('Invalid GitHub identity');
        }
        return { id: String(user.data.id), login: user.data.login };
    }

    async function lookupUser(login) {
        if (typeof login !== 'string' || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(login)) {
            return null;
        }
        try {
            const response = await axios.get(`https://api.github.com/users/${encodeURIComponent(login)}`, {
                timeout: 10000,
                maxContentLength: 32768,
                maxBodyLength: 32768,
                maxRedirects: 0,
                headers: { Accept: 'application/vnd.github+json' },
            });
            const user = response.data;
            if (user.type === 'Organization' || user.type === 'Bot') {
                return null;
            }
            if (!Number.isSafeInteger(user.id) || user.id < 1 || user.type !== 'User' ||
                typeof user.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(user.login)) {
                throw new Error('Invalid GitHub account');
            }
            return { id: String(user.id), login: user.login };
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    return { configured, enabled, ownerId, authorize, identify, lookupUser };
}

module.exports = createGithubAuth;
