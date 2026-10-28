const { isIP } = require('node:net');

function normalizeIP(ip) {
    if (isIP(ip) !== 6) return ip;
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [left, right = ''] = canonical.split('::');
    const start = left ? left.split(':') : [];
    const end = right ? right.split(':') : [];
    const words = canonical.includes('::')
        ? [...start, ...Array(8 - start.length - end.length).fill('0'), ...end]
        : start;
    const values = words.map(word => parseInt(word, 16));
    if (values.slice(0, 5).every(value => value === 0) && values[5] === 65535) {
        return [values[6] >> 8, values[6] & 255, values[7] >> 8, values[7] & 255].join('.');
    }
    return canonical;
}

function getIPFromRequest(req) {
    return normalizeIP(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress);
}

// Group IPv6 clients by /56 so rotating interface addresses cannot reset limits.
function getRateLimitKey(req) {
    const ip = getIPFromRequest(req);
    if (isIP(ip) !== 6) return ip;
    const [left, right = ''] = ip.split('::');
    const start = left ? left.split(':') : [];
    const end = right ? right.split(':') : [];
    const words = ip.includes('::')
        ? [...start, ...Array(8 - start.length - end.length).fill('0'), ...end]
        : start;
    return `${words.slice(0, 3).map(word => parseInt(word, 16).toString(16)).join(':')}:${(parseInt(words[3], 16) & 0xff00).toString(16)}::/56`;
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
    normalizeIP,
    getRateLimitKey,
    getIPFromRequest,
    getRawURLFromRequest,
    getClientFromRequest,
    mysqlToBool,
    isNumeric,
    cleanStats,
}
