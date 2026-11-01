const log = require('../libs/logger');
const tools = require('../libs/tools');
const asyncRoute = require('../libs/asyncRoute');
const repo = require('../libs/pixelItRepo');
const cache = require('../libs/cache');
const { validBitmap } = require('../libs/validation');
const { saveBitmapLimiter } = require('../libs/rateLimit');

function registerBitmapRoutes(app) {
    app.get('/api/GetBMPByID/:id', asyncRoute(getBitmapById));
    app.get('/api/GetBMPByID_v2/:id', asyncRoute(getBitmapByIdV2));
    app.get('/api/GetBMPNewst', asyncRoute(getNewestBitmap));
    app.get('/api/GetBMPAll', asyncRoute(getBitmaps));
    app.post('/api/SaveBitmap', saveBitmapLimiter, asyncRoute(saveBitmap));
}

async function getBitmapById(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const id = req.params.id;
    const uuid = req.query.uuid || '';

    if (tools.isNumeric(id) == false) {
        log.warn('{apiPath}: {id} is not a valid ID!', {
            apiPath: 'GetBMPByID',
            id,
            sourceIP,
            rawUrl,
            useragent: req.useragent,
            rateLimit: req.rateLimit,
            uuid: uuid,
        });
        res.status(400).send('Not valid ID');
        return;
    }

    const bmp = await cache.getOrSet(
        `GetBMPByID_${id}`,
        () => {
            return repo.getBMPByID(id);
        },
        0
    );

    if (!bmp) {
        log.warn('{apiPath}: BMP ID: {id} is not valide', {
            apiPath: 'GetBMPByID',
            id: id,
            sourceIP,
            rawUrl,
            useragent: req.useragent,
            rateLimit: req.rateLimit,
            uuid: uuid,
        });
        res.status(400).send(`BMP ID: ${id} is not valide`);
        return;
    }

    log.info('{apiPath}: BMP with ID {id} and name {name} successfully delivered', {
        apiPath: 'GetBMPByID',
        id: bmp.id,
        name: bmp.name,
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });
    res.send(bmp);
}

async function getBitmapByIdV2(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const id = req.params.id;
    const uuid = req.query.uuid || '';

    if (tools.isNumeric(id) == false) {
        log.warn('{apiPath}: {id} is not a valid ID!', {
            apiPath: 'GetBMPByID_v2',
            id,
            sourceIP,
            rawUrl,
            useragent: req.useragent,
            rateLimit: req.rateLimit,
            uuid: uuid,
        });
        res.status(400).send('Not valid ID');
        return;
    }

    const bmp = await cache.getOrSet(
        `GetBMPByID_v2_${id}`,
        () => {
            return repo.getBMPByID_v2(id);
        },
        0
    );

    if (!bmp) {
        log.warn('{apiPath}: BMP ID: {id} is not valide', {
            apiPath: 'GetBMPByID_v2',
            id: id,
            sourceIP,
            rawUrl,
            useragent: req.useragent,
            rateLimit: req.rateLimit,
            uuid: uuid,
        });
        res.status(400).send(`BMP ID: ${id} is not valide`);
        return;
    }

    log.info('{apiPath}: BMP with ID {id} and name {name} successfully delivered', {
        apiPath: 'GetBMPByID_v2',
        id: bmp.id,
        name: bmp.name,
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });
    res.send(bmp);
}

async function getNewestBitmap(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const bmp =
        (await cache.getOrSet(
            'GetBMPNewst',
            () => {
                return repo.getBMPNewst();
            },
            30
        )) ?? {};
    log.info('{apiPath} BMP with ID {id} and name {name} successfully delivered', {
        apiPath: 'GetBMPNewst',
        id: bmp.id,
        name: bmp.name,
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });
    res.send(bmp);
}

async function getBitmaps(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';
    const bmps =
        (await cache.getOrSet(
            'GetBMPAll',
            () => {
                return repo.getBMPAll();
            },
            30
        )) ?? [];
    log.info('{apiPath}: {count} BMPs successfully delivered', {
        apiPath: 'GetBMPAll',
        count: bmps.length,
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });
    res.send(bmps);
}

async function saveBitmap(req, res, next) {
    if (!validBitmap(req.body)) {
        return res.status(400).send('Not valid body');
    }
    try {
        await repo.saveBMP({ ...req.body });
        log.info('{apiPath}: Successfully saved', {
            apiPath: 'SaveBitmap',
            sourceIP: tools.getIPFromRequest(req),
            client: tools.getClientFromRequest(req),
            rateLimit: req.rateLimit,
        });
        res.sendStatus(200);
    } catch (error) {
        next(error);
    }
}

module.exports = registerBitmapRoutes;
