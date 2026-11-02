const log = require('../libs/logger');
const tools = require('../libs/tools');
const asyncRoute = require('../libs/asyncRoute');
const cache = require('../libs/cache');
const gitRepo = require('../libs/gitRepo');

function registerReleaseRoutes(app) {
    app.get('/api/LastVersion', asyncRoute(getLastVersion));
    app.get('/api/LastRelease', asyncRoute(getLastRelease));
    app.get('/api/OfficialReleases', asyncRoute(getOfficialReleases));
    app.get('/api/Releases', asyncRoute(getReleases));
}

async function getLastVersion(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const releases =
        (await cache.getOrSet(
            'Releases',
            () => {
                return gitRepo.getGitReleases();
            },
            600
        )) ?? [];
    const lastReleaseData = { ...(releases.find((release) => (release.prerelease === false || (req.query.includePrereleases === 'true' && release.prerelease === true))) || {}) };

    for (const key of ['downloads', 'downloadURL', 'fwdownloads', 'releaseNoteArray', 'readmeLink', 'date']) {
        delete lastReleaseData[key];
    }

    log.info('{apiPath}: Version {version} successfully delivered', {
        apiPath: 'LastVersion',
        version: lastReleaseData.version,
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });

    res.send(lastReleaseData);
}

async function getLastRelease(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const releases =
        (await cache.getOrSet(
            'Releases',
            () => {
                return gitRepo.getGitReleases();
            },
            600
        )) ?? [];
    const lastReleaseData = releases.find((release) => release.prerelease === false) || {};

    log.info('{apiPath}: Version {version} successfully delivered', {
        apiPath: 'LastRelease',
        version: lastReleaseData.version,
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });

    res.send(lastReleaseData);
}

async function getOfficialReleases(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const releasesArray =
        (await cache.getOrSet(
            'Releases',
            () => {
                return gitRepo.getGitReleases();
            },
            600
        )) ?? [];
    let data = { releases: [] };

    if (releasesArray.length > 0) {
        data.releases = releasesArray
            .filter((release) => release.prerelease === false)
            .map((x) => x.version)
            .filter((x) => x != '');
    }

    log.info('{apiPath}: Version {versions} successfully delivered', {
        apiPath: 'OfficialReleases',
        versions: data.releases.map((value) => value).join(', '),
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });

    res.send(data);
}

async function getReleases(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    let releases =
        (await cache.getOrSet(
            'Releases',
            () => {
                return gitRepo.getGitReleases();
            },
            600
        )) ?? [];

    if (releases.length > 0) {
        // Retain four stable releases even when several betas were published recently.
        const stable = releases.filter((release) => release.prerelease === false).slice(0, 4);
        const prereleases = req.query.includePrereleases === 'true'
            ? releases.filter((release) => release.prerelease === true).slice(0, 4)
            : [];
        releases = releases.filter((release) => stable.includes(release) || prereleases.includes(release));
    }

    log.info('{apiPath}: Versions {versions} successfully delivered', {
        apiPath: 'Releases',
        versions: releases.map((value) => value.version).join(', '),
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });

    res.send(releases);
}

module.exports = registerReleaseRoutes;
