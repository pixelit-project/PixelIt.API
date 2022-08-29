function getIPFromRequest(req) {
    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (ip.substr(0, 7) == "::ffff:") {
        ip = ip.substr(7)
    }
    return ip;
}

function getRawURLFromRequest(req) {
    return `${req.protocol}://${req.get('host')}${req.originalUrl}`;;
}

function mysqlToBool(value) {
    return value == 1;
}

module.exports = {
    getIPFromRequest,
    getRawURLFromRequest,
    mysqlToBool,
};