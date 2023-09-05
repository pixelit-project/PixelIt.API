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
const { apiLimiter, telemetryLimiter, saveBitmapLimiter } = require('./libs/rateLimit');

const port = process.env.PORT || 8080;

// defining the Express app
const app = express();
app.use(useragent.express());
// adding Helmet to enhance your Rest API's security
app.use(helmet());
// using bodyParser to parse JSON bodies into JS objects
app.use(bodyParser.json());
// enabling CORS for all requests
app.use(cors());

app.use('/api/', apiLimiter);

app.get('/api/GetBMPByID/:id', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const id = req.params.id;

    if (tools.isNumeric(id) == false) {
        log.warn('{apiPath}: {id} is not a valid ID!', { apiPath: 'GetBMPByID', id, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });
        res.status(400).send('Not valid ID');
        return;
    }

    const bmp = (await cache.getOrSet(`GetBMPByID_${id}`, () => { return repo.getBMPByID(id) }, 0)) ?? {};

    log.info('{apiPath}: BMP with ID {id} and name {name} successfully delivered', { apiPath: 'GetBMPByID', id: bmp.id, name: bmp.name, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });
    res.send(bmp);
});

app.get('/api/GetBMPNewst', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const bmp = (await cache.getOrSet('GetBMPNewst', () => { return repo.getBMPNewst() }, 30)) ?? {};
    log.info('{apiPath} BMP with ID {id} and name {name} successfully delivered', { apiPath: 'GetBMPNewst', id: bmp.id, name: bmp.name, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });
    res.send(bmp);
});

app.get('/api/GetBMPAll', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const bmps = (await cache.getOrSet('GetBMPAll', () => { return repo.getBMPAll() }, 30)) ?? [];

    log.info('{apiPath}: {count} BMPs successfully delivered', { apiPath: 'GetBMPAll', count: bmps.length, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });
    res.send(bmps);
});

app.post('/api/Telemetry', telemetryLimiter, async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);

    if (!req.body) {
        log.error('{apiPath}: No body found', { apiPath: 'Telemetry', sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });
        res.status(400).send('Not valid body');
        return;
    }

    (async () => {
        req.body.geoip = await geoip.lookup(sourceIP);
        log.info(`{apiPath}: ${JSON.stringify(req.body)}`, { apiPath: 'Telemetry', sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });
        repo.saveStats(req.body);
    })();

    res.sendStatus(200);
});

app.get('/api/UserMapData', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const userMapData = (await cache.getOrSet('UserMapData', () => { return repo.getUserMapData() }, 30)) ?? [];

    log.info('{apiPath}: {count} User successfully delivered', { apiPath: 'UserMapData', count: userMapData.length, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });
    res.send(userMapData);
});

app.get('/api/LastVersion', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const releases = (await cache.getOrSet('Releases', () => { return gitRepo.getGitReleases() }, 600)) ?? [];
    let lastReleaseData = {};

    if (releases.length > 0) {
        lastReleaseData = releases[0];
    }

    for (const key of ['downloads', 'downloadURL', 'fwdownloads', 'releaseNoteArray', 'readmeLink', 'date']) {
        delete lastReleaseData[key];
    }

    log.info('{apiPath}: Version {version} successfully delivered', { apiPath: 'LastVersion', version: lastReleaseData.version, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });

    res.send(lastReleaseData);
});

app.get('/api/LastRelease', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const releases = (await cache.getOrSet('Releases', () => { return gitRepo.getGitReleases() }, 600)) ?? [];
    let lastReleaseData = {};

    if (releases.length > 0) {
        lastReleaseData = releases[0];
    }

    log.info('{apiPath}: Version {version} successfully delivered', { apiPath: 'LastRelease', version: lastReleaseData.version, sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });


    res.send(lastReleaseData);
});

app.get('/api/Releases', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const releases = await cache.getOrSet('Releases', () => { return gitRepo.getGitReleases() }, 600) ?? [];

    log.info('{apiPath}: Versions {versions} successfully delivered', { apiPath: 'Releases', versions: releases.map(value => value.version).join(', '), sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, });

    res.send(releases);
});

app.post('/api/SaveBitmap', saveBitmapLimiter, async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const geoipData = await geoip.lookup(sourceIP);

    if (!req.body) {
        log.error('{apiPath}: No body found', { apiPath: 'SaveBitmap', sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, geoip: geoipData, });
        res.status(400).send('Not valid body');
        return;
    }

    (async () => {
        log.info(`{apiPath}: ${JSON.stringify(req.body)}`, { apiPath: 'SaveBitmap', sourceIP, rawUrl, useragent: req.useragent, rateLimit: req.rateLimit, geoip: geoipData, });
        repo.saveBMP(req.body);
    })();

    res.sendStatus(200);
});

// starting the server
app.listen(port, () => {
    log.info('API listening on port {port}', { port, });
});
