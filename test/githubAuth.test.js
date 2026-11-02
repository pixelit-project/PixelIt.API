const { test } = require('node:test');
const assert = require('node:assert/strict');
const axiosPath = require.resolve('axios');
let mode = 'valid';
let lookupMode = 'valid';
let lookups = 0;
require.cache[axiosPath] = {
    id: axiosPath, filename: axiosPath, loaded: true,
    exports: {
        async post(url, body, options) {
            assert.equal(body.code_verifier, 'verifier');
            assert.equal(body.redirect_uri, 'https://example.test/api/admin/github/callback');
            assert.equal(options.timeout, 10000);
            assert.equal(options.maxRedirects, 0);
            assert.equal(options.maxContentLength, 32768);
            if (mode === 'failure') {
                throw new Error('network failure');
            }
            return { data: mode === 'no-token' ? {} : { access_token: 'token' } };
        },
        async get(url, options) {
            if (url.includes('/users/')) {
                lookups++;
                assert.equal(url, 'https://api.github.com/users/octocat');
                assert.equal(options.timeout, 10000);
                assert.equal(options.maxContentLength, 32768);
                assert.equal(options.maxRedirects, 0);
                assert.equal(options.headers.Authorization, undefined);
                if (lookupMode === 'missing') { throw { response: { status: 404 } }; }
                if (lookupMode === 'rate-limited') { throw { response: { status: 403 } }; }
                return { data: { id: lookupMode === 'invalid' ? '2' : 2, login: 'Octocat', type: lookupMode === 'organization' ? 'Organization' : 'User' } };
            }
            assert.equal(options.headers.Authorization, 'Bearer token');
            return { data: mode === 'bad-user' ? { id: '123', login: 'user' } : { id: 123, login: 'user' } };
        },
    },
};
const createGithubAuth = require('../libs/githubAuth');
test('GitHub OAuth requests minimal identity, uses PKCE and rejects malformed upstream responses', async () => {
    const github = createGithubAuth({
        ADMIN_GITHUB_CLIENT_ID: 'client', ADMIN_GITHUB_CLIENT_SECRET: 'secret',
        ADMIN_GITHUB_OWNER_ID: '1', ADMIN_ORIGIN: 'https://example.test',
    });
    assert.equal(github.enabled, true);
    const authorization = new URL(github.authorize('state', 'challenge'));
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.has('scope'), false);
    assert.deepEqual(await github.identify('code', 'verifier'), { id: '123', login: 'user' });
    for (const invalid of ['no-token', 'bad-user', 'failure']) {
        mode = invalid;
        await assert.rejects(github.identify('code', 'verifier'));
    }
    assert.equal(createGithubAuth({}).configured, false);
    assert.equal(createGithubAuth({ ADMIN_GITHUB_CLIENT_ID: 'client' }).enabled, false);
});

test('moderators are resolved by validated GitHub username with bounded requests and safe missing-user handling', async () => {
    const github = createGithubAuth({});
    assert.equal(await github.lookupUser('../admin'), null);
    assert.equal(await github.lookupUser(''), null);
    assert.equal(lookups, 0);
    assert.deepEqual(await github.lookupUser('octocat'), { id: '2', login: 'Octocat' });
    lookupMode = 'missing';
    assert.equal(await github.lookupUser('octocat'), null);
    lookupMode = 'organization';
    assert.equal(await github.lookupUser('octocat'), null);
    for (const failure of ['invalid', 'rate-limited']) {
        lookupMode = failure;
        await assert.rejects(github.lookupUser('octocat'));
    }
});
