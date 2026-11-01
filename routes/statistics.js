const log = require('../libs/logger');
const tools = require('../libs/tools');
const asyncRoute = require('../libs/asyncRoute');
const repo = require('../libs/pixelItRepo');
const cache = require('../libs/cache');
const gitRepo = require('../libs/gitRepo');

const telemetryUserCheck = process.env.TELEMETRY_USER_CHECK
    ? process.env.TELEMETRY_USER_CHECK.toUpperCase() == 'TRUE'
    : false;

function registerStatisticsRoutes(app) {
    app.get(['/api/UserMap', '/api/UserMapData'], asyncRoute(getUserMap));
    app.get('/api/Statistics', asyncRoute(getStatistics));
}

async function getUserMap(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';

    if (telemetryUserCheck == true) {
        const isTelemetryUser = await cache.getOrSet(
            `IsTelemetryUser_UUID:${uuid}`,
            () => {
                return repo.isTelemetryUser(uuid);
            },
            30
        );

        if (!isTelemetryUser) {
            res.send({ coords: [], error: { telemetryUser: false } });
            log.info('{apiPath}: UserMap NOT delivered, reason: no telemetry user!', {
                apiPath: 'UserMap',
                sourceIP,
                rawUrl,
                useragent: req.useragent,
                uuid: uuid,
                rateLimit: req.rateLimit,
            });
            return;
        }
    }

    const userMapData =
        (await cache.getOrSet(
            'UserMap',
            () => {
                return repo.getUserMapData();
            },
            30
        )) ?? [];

    log.info('{apiPath}: UserMap ({count} user) successfully delivered', {
        apiPath: 'UserMap',
        count: userMapData.length,
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });
    res.send({ coords: userMapData });
}

async function getStatistics(req, res) {
    const sourceIP = tools.getIPFromRequest(req);
    const rawUrl = tools.getRawURLFromRequest(req);
    const uuid = req.query.uuid || '';

    if (telemetryUserCheck == true) {
        const isTelemetryUser = await cache.getOrSet(
            `IsTelemetryUser_UUID:${uuid}`,
            () => {
                return repo.isTelemetryUser(uuid);
            },
            30
        );

        if (!isTelemetryUser) {
            res.send({ error: { telemetryUser: false } });
            log.info('{apiPath}: Statistics NOT delivered, reason: no telemetry user!', {
                apiPath: 'Statistics',
                sourceIP,
                rawUrl,
                useragent: req.useragent,
                uuid: uuid,
                rateLimit: req.rateLimit,
            });
            return;
        }
    }

    const result =
        (await cache.getOrSet(
            'Statistics',
            async () => {
                const releasesArray =
                    (await cache.getOrSet(
                        'Releases',
                        () => {
                            return gitRepo.getGitReleases();
                        },
                        600
                    )) ?? [];
                const officialBuilds =
                    (await cache.getOrSet(
                        'OfficialBuilds',
                        () => {
                            return gitRepo.getOfficialBuilds();
                        },
                        600
                    )) ?? [];
                const statistics = await repo.getStatistics();
                tools.cleanStats(releasesArray, statistics, officialBuilds);
                return statistics;
            },
            30
        )) ?? {};

    log.info('{apiPath}: Statistics successfully delivered', {
        apiPath: 'Statistics',
        sourceIP,
        rawUrl,
        useragent: req.useragent,
        rateLimit: req.rateLimit,
        uuid: uuid,
    });
    res.send(result);
}

module.exports = registerStatisticsRoutes;
