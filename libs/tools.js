function getIPFromRequest(req) {
    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
    if (ip.substr(0, 7) == '::ffff:') {
        ip = ip.substr(7)
    }
    return ip
}

function getRawURLFromRequest(req) {
    return `${req.protocol}://${req.get('host')}${req.originalUrl}`
}


function getClientFromRequest(req) {
    return req.headers.client || 'Not set'
}


function mysqlToBool(value) {
    return value == 1
}

function isNumeric(value) {
    return /^\d+$/.test(value);
}

function cleanStats(releasesArray, statistics, officialBuilds) {
    let count = 0;
    let officialReleases = [];
    if (releasesArray.length > 0) {
        officialReleases = releasesArray.map(x => x.version).filter(x => x != '');
    }
    for (const versionStat of statistics.versionStats) {
        if (!officialReleases.includes(versionStat.version)) {
            // Tag as unofficial versions
            versionStat.version = 'remove_';
            // Count 
            count += versionStat.count;
        }
    }
    statistics.versionStats = statistics.versionStats.filter(x => x.version != 'remove_');
    statistics.versionStats.push({ version: 'Self compiled', count });

    // Clean builds      
    count = 0;
    for (const buildStat of statistics.buildStats) {
        if (!officialBuilds.includes(buildStat.build) && buildStat.build != 'No_Data') {
            // Tag as unofficial versions
            buildStat.build = 'remove_';
            // Count 
            count += buildStat.count;
        }
    }
    statistics.buildStats = statistics.buildStats.filter(x => x.build != 'remove_');
    statistics.buildStats.splice(statistics.buildStats.length - 1, 0, { build: 'Custom', count });
}

module.exports = {
    getIPFromRequest,
    getRawURLFromRequest,
    getClientFromRequest,
    mysqlToBool,
    isNumeric,
    cleanStats,
}
