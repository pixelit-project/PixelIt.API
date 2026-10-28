require('dotenv').config()
const express = require('express');
const useragent = require('express-useragent');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const log = require('./libs/logger');
const tools = require('./libs/tools');
const cache = require('./libs/cache');
const gitRepo = require('./libs/gitRepo');
const geoip = require('fast-geoip');
const repo = require('./libs/pixelItRepo');
const { validBitmap, validTelemetry } = require('./libs/validation');
const { apiLimiter, telemetryLimiter, saveBitmapLimiter } = require('./libs/rateLimit');

const port = process.env.PORT || 8080;
const telemetryUserCheck = process.env.TELEMETRY_USER_CHECK ? process.env.TELEMETRY_USER_CHECK.toUpperCase() == "TRUE" : false

// Express 4 does not forward rejected async handlers to error middleware.
const asyncRoute = handler => (req, res, next) => {
    Promise.resolve().then(() => handler(req, res, next)).catch(next);
};

// defining the Express app
const app = express();
// Only explicitly configured proxy addresses may supply the client IP.
app.set('trust proxy', process.env.TRUSTED_PROXIES
    ? process.env.TRUSTED_PROXIES.split(',').map(value => value.trim()).filter(Boolean)
    : false);
app.use(useragent.express());
// adding Helmet to enhance your Rest API's security
app.use(helmet());
// using bodyParser to parse JSON bodies into JS objects
app.use(bodyParser.json());
// enabling CORS for all requests
app.use(cors());

app.use('/api/', apiLimiter);

app.get('/api/GetBMPByID/:id', asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const id = req.params.id;
    const uuid = req.query.uuid || '';

    if (tools.isNumeric(id) == false) {
        log.warn('{apiPath}: {id} is not a valid ID!', { apiPath: 'GetBMPByID', id, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
        res.status(400).send('Not valid ID');
        return;
    }

    const bmp = (await cache.getOrSet(`GetBMPByID_${id}`, () => { return repo.getBMPByID(id) }, 0));

    if (!bmp) {
        log.warn('{apiPath}: BMP ID: {id} is not valide', { apiPath: 'GetBMPByID', id: id, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
        res.status(400).send(`BMP ID: ${id} is not valide`);
        return;
    }

    log.info('{apiPath}: BMP with ID {id} and name {name} successfully delivered', { apiPath: 'GetBMPByID', id: bmp.id, name: bmp.name, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
    res.send(bmp);
}));

app.get('/api/GetBMPByID_v2/:id', asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const id = req.params.id;
    const uuid = req.query.uuid || '';

    if (tools.isNumeric(id) == false) {
        log.warn('{apiPath}: {id} is not a valid ID!', { apiPath: 'GetBMPByID_v2', id, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
        res.status(400).send('Not valid ID');
        return;
    }

    const bmp = (await cache.getOrSet(`GetBMPByID_v2_${id}`, () => { return repo.getBMPByID_v2(id) }, 0));

    if (!bmp) {
        log.warn('{apiPath}: BMP ID: {id} is not valide', { apiPath: 'GetBMPByID_v2', id: id, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
        res.status(400).send(`BMP ID: ${id} is not valide`);
        return;
    }

    log.info('{apiPath}: BMP with ID {id} and name {name} successfully delivered', { apiPath: 'GetBMPByID_v2', id: bmp.id, name: bmp.name, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
    res.send(bmp);
}));

app.get('/api/GetBMPNewst', asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const bmp = (await cache.getOrSet('GetBMPNewst', () => { return repo.getBMPNewst() }, 30)) ?? {};
    log.info('{apiPath} BMP with ID {id} and name {name} successfully delivered', { apiPath: 'GetBMPNewst', id: bmp.id, name: bmp.name, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
    res.send(bmp);
}));

app.get('/api/GetBMPAll', asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const bmps = (await cache.getOrSet('GetBMPAll', () => { return repo.getBMPAll() }, 30)) ?? [];
    log.info('{apiPath}: {count} BMPs successfully delivered', { apiPath: 'GetBMPAll', count: bmps.length, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
    res.send(bmps);
}));

app.post('/api/Telemetry', telemetryLimiter, asyncRoute(async (req, res, next) => {
    if (!validTelemetry(req.body)) {
        return res.status(400).send('Not valid body');
    }
    try {
        const telemetry = { ...req.body, geoip: await geoip.lookup(tools.getIPFromRequest(req)) };
        await repo.saveTelemetry(telemetry);
        log.info('{apiPath}: Successfully saved', {
            apiPath: 'Telemetry', uuid: telemetry.uuid, sourceIP: tools.getIPFromRequest(req),
            client: tools.getClientFromRequest(req), rateLimit: req.rateLimit,
        });
        res.sendStatus(200);
    } catch (error) {
        next(error);
    }
}));

app.get(['/api/UserMap', '/api/UserMapData'], asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';

    if (telemetryUserCheck == true) {
        const isTelemetryUser = await cache.getOrSet(`IsTelemetryUser_UUID:${uuid}`, () => { return repo.isTelemetryUser(uuid) }, 30);

        if (!isTelemetryUser) {
            res.send({ coords: [], error: { telemetryUser: false } });
            log.info('{apiPath}: UserMap NOT delivered, reason: no telemetry user!', { apiPath: 'UserMap', sourceIP, rawUrl, useragent: req.useragent, uuid: uuid, rateLimit: req.rateLimit, });
            return;
        }
    }

    const userMapData = (await cache.getOrSet('UserMap', () => { return repo.getUserMapData() }, 30)) ?? [];

    log.info('{apiPath}: UserMap ({count} user) successfully delivered', { apiPath: 'UserMap', count: userMapData.length, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
    res.send({ coords: userMapData });
}));

app.get('/api/Statistics', asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';

    if (telemetryUserCheck == true) {
        const isTelemetryUser = await cache.getOrSet(`IsTelemetryUser_UUID:${uuid}`, () => { return repo.isTelemetryUser(uuid) }, 30);

        if (!isTelemetryUser) {
            res.send({ error: { telemetryUser: false } });
            log.info('{apiPath}: Statistics NOT delivered, reason: no telemetry user!', { apiPath: 'Statistics', sourceIP, rawUrl, useragent: req.useragent, uuid: uuid, rateLimit: req.rateLimit, });
            return;
        }
    }

    const result = (await cache.getOrSet('Statistics', async () => {
        const releasesArray = (await cache.getOrSet('Releases', () => { return gitRepo.getGitReleases() }, 600)) ?? [];
        const officialBuilds = (await cache.getOrSet('OfficialBuilds', () => { return gitRepo.getOfficialBuilds() }, 600)) ?? [];
        const statistics = await repo.getStatistics()
        tools.cleanStats(releasesArray, statistics, officialBuilds);
        return statistics;
    }, 30)) ?? {};

    log.info('{apiPath}: Statistics successfully delivered', { apiPath: 'Statistics', sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });
    res.send(result);
}));

app.get('/api/LastVersion', asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const releases = (await cache.getOrSet('Releases', () => { return gitRepo.getGitReleases() }, 600)) ?? [];
    const lastReleaseData = { ...(releases.find(release => release.prerelease === false) || {}) };

    for (const key of ['downloads', 'downloadURL', 'fwdownloads', 'releaseNoteArray', 'readmeLink', 'date']) {
        delete lastReleaseData[key];
    }

    log.info('{apiPath}: Version {version} successfully delivered', { apiPath: 'LastVersion', version: lastReleaseData.version, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });

    res.send(lastReleaseData);
}));

app.get('/api/LastRelease', asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const releases = (await cache.getOrSet('Releases', () => { return gitRepo.getGitReleases() }, 600)) ?? [];
    const lastReleaseData = releases.find(release => release.prerelease === false) || {};

    log.info('{apiPath}: Version {version} successfully delivered', { apiPath: 'LastRelease', version: lastReleaseData.version, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });


    res.send(lastReleaseData);
}));

app.get('/api/OfficialReleases', asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const releasesArray = (await cache.getOrSet('Releases', () => { return gitRepo.getGitReleases() }, 600)) ?? [];
    let data = { releases: [] };

    if (releasesArray.length > 0) {
        data.releases = releasesArray.filter(release => release.prerelease === false).map(x => x.version).filter(x => x != '');
    }

    log.info('{apiPath}: Version {versions} successfully delivered', { apiPath: 'OfficialReleases', versions: data.releases.map(value => value).join(', '), sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid, });

    res.send(data);
}));

app.get('/api/Releases', asyncRoute(async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    let releases = await cache.getOrSet('Releases', () => { return gitRepo.getGitReleases() }, 600) ?? [];

    if (releases.length > 0) {
        // No pre-release and the latest 4 releases 
        releases = releases.filter(x => x.prerelease == false).slice(0, 4);
    }

    log.info('{apiPath}: Versions {versions} successfully delivered', { apiPath: 'Releases', versions: releases.map(value => value.version).join(', '), sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, uuid: uuid });

    res.send(releases);
}));

app.post('/api/SaveBitmap', saveBitmapLimiter, asyncRoute(async (req, res, next) => {
    if (!validBitmap(req.body)) {
        return res.status(400).send('Not valid body');
    }
    try {
        await repo.saveBMP({ ...req.body });
        log.info('{apiPath}: Successfully saved', {
            apiPath: 'SaveBitmap', sourceIP: tools.getIPFromRequest(req),
            client: tools.getClientFromRequest(req), rateLimit: req.rateLimit,
        });
        res.sendStatus(200);
    } catch (error) {
        next(error);
    }
}));

app.use((error, req, res, next) => {
    log.error('Request failed: {error}', { error, sourceIP: tools.getIPFromRequest(req) });
    if (res.headersSent) return next(error);
    const messages = {
        400: 'Not valid body',
        413: 'Not valid body',
        502: 'Upstream service unavailable',
        504: 'Upstream service timed out',
    };
    const status = Object.hasOwn(messages, error.status) ? error.status : 500;
    res.status(status).send(messages[status] || 'Internal server error');
});

if (require.main === module) {
    app.listen(port, () => {
        log.info('API listening on port {port}', { port });
    });
}

module.exports = app;
