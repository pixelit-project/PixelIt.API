const { test } = require('node:test');
const assert = require('node:assert/strict');
let get;
require.cache[require.resolve('axios')] = { loaded: true, exports: {
    default: { get: (...args) => get(...args) },
} };
require.cache[require.resolve('../libs/logger')] = { loaded: true, exports: { info: () => {}, error: () => {} } };
const repo = require('../libs/gitRepo');

test('GitHub requests have a timeout and tokens are limited to API requests', async () => {
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token';
    try {
        get = async (url, config) => {
            assert.equal(config.timeout, 10000);
            if (url.includes('api.github.com')) {
                assert.equal(config.headers.Authorization, 'Bearer test-token');
                return { data: [], headers: {} };
            }
            assert.equal(config.headers, undefined);
            return { data: '[env:test]\n-DBUILD_SECTION=official\n', headers: {} };
        };
        assert.deepEqual(await repo.getGitReleases(), []);
        assert.deepEqual(await repo.getOfficialBuilds(), ['official']);
        delete process.env.GITHUB_TOKEN;
        get = async (url, config) => {
            assert.equal(config.headers, undefined, 'a removed token must not remain cached');
            return { data: [], headers: {} };
        };
        await repo.getGitReleases();
    } finally {
        if (previous === undefined) delete process.env.GITHUB_TOKEN;
        else process.env.GITHUB_TOKEN = previous;
    }
});

test('release parsing tolerates missing optional metadata and skips drafts', async () => {
    get = async () => ({ headers: {}, data: [
        { name: 'Draft', draft: true },
        { tag_name: '3.3.3', prerelease: false, published_at: '2026-10-28T12:00:00Z', body: null },
    ] });
    const releases = await repo.getGitReleases();
    assert.equal(releases.length, 1);
    assert.equal(releases[0].version, '3.3.3');
    assert.equal(releases[0].date, '2026-10-28');
    assert.equal(releases[0].downloads, 0);
    assert.deepEqual(releases[0].fwdownloads, []);
    assert.deepEqual(releases[0].releaseNoteArray, ['']);
});

test('GitHub failures propagate as upstream errors instead of cacheable empty data', async () => {
    for (const code of ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET']) {
        get = async () => { throw Object.assign(new Error('private details'), { code }); };
        for (const load of [repo.getGitReleases, repo.getOfficialBuilds]) {
            await assert.rejects(load(), error => error.status === (code === 'ECONNRESET' ? 502 : 504) && error.message === 'GitHub request failed');
        }
    }
});


test('firmware downloads preserve original filenames and browser URLs alongside existing labels', async () => {
    const filename = 'firmware_v2.7.0_ESP8266_d1_mini.bin';
    const url = `https://github.com/pixelit-project/PixelIt/releases/download/2.7.0/${filename}`;
    get = async () => ({ headers: {}, data: [{
        name: 'Release 2.7.0', tag_name: '2.7.0', prerelease: false,
        assets: [{ name: filename, browser_download_url: url, download_count: 7 }],
    }] });
    const [release] = await repo.getGitReleases();
    assert.equal(release.version, 'Release 2.7.0');
    assert.equal(release.downloads, 7);
    assert.deepEqual(release.fwdownloads, [{
        name: 'ESP8266 D1 MINI', downloads: 7, fileName: filename, downloadURL: url,
    }]);
});
