
const mysql = require('mysql2/promise');
const tools = require('./tools')
const log = require('./logger')
const countries = require("i18n-iso-countries");
countries.registerLocale(require("i18n-iso-countries/langs/en.json"));

const connection = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

async function getBMPByID(id) {
    let result;
    try {
        result = await connection.query(
            `select 
                        a.id, 
                        a.datetime AS dateTime,
                        a.name,
                        a.rgb565array AS rgB565Array,
                        a.animated,
                        a.sizex AS sizeX,
                        a.sizey AS sizeY,
                        a.userid AS userID,
                        b.name as username,
                        IFNULL(c.hitcount,0) as hitCount
                        from pixel_it_bitmap a 
                        join pixel_it_user b on (a.userid  = b.id)
                        left outer join pixel_it_hitcount c on (a.id = c.pixel_id) 
                        where
                            a.id = ?`,
            id
        );
        if (result[0][0]) {
            result[0][0].animated = tools.mysqlToBool(result[0][0].animated);
            return result[0][0];
        }

    } catch (error) {
        log.error('getBMPByID: {error}', { error: error })
        return undefined
    }
};

async function getBMPByID_v2(id) {
    let result;
    try {
        result = await getBMPByID(id);
        if (result) {
            if (result.animated == true) {
                result.rgb565array = `[${result.rgb565array}]`;
            }
            return result;
        }

    } catch (error) {
        log.error('getBMPByID_v2: {error}', { error: error })
        return undefined
    }
};

async function getBMPAll() {
    let result
    try {
        result = await connection.query(`select 
                            a.id, 
                            a.datetime AS dateTime,
                            a.name,
                            a.rgb565array AS rgB565Array,
                            a.animated,
                            a.sizex AS sizeX,
                            a.sizey AS sizeY,
                            a.userid AS userID,
                            b.name as username,
                            IFNULL(c.hitcount,0) as hitCount
                        from pixel_it_bitmap a 
                        join pixel_it_user b on (a.userid  = b.id)
                        left outer join pixel_it_hitcount c on (a.id = c.pixel_id)`)

        for (const bmp of result[0]) {
            bmp.animated = tools.mysqlToBool(bmp.animated)
        }

        return result[0]
    } catch (error) {
        log.error('getBMPAll: {error}', { error: error })
        return null
    }
};

async function getBMPNewst() {
    let result
    try {
        result = await connection.query(`select 
                            a.id, 
                            a.datetime AS dateTime,
                            a.name,
                            a.rgb565array AS rgB565Array,
                            a.animated,
                            a.sizex AS sizeX,
                            a.sizey AS sizeY,
                            a.userid AS userID,
                            b.name as username,
                            IFNULL(c.hitcount,0) as hitCount
                        from pixel_it_bitmap a 
                        join pixel_it_user b on (a.userid  = b.id)
                        left outer join pixel_it_hitcount c on (a.id = c.pixel_id) 
                        where
                            a.id = (select max(id) from pixel_it_bitmap)`)

        result[0][0].animated = tools.mysqlToBool(result[0][0].animated)

        return result[0][0]
    } catch (error) {
        log.error('getBMPNewst: {error}', { error: error })
        return null
    }
}

async function saveTelemetry(telemetry) {
    try {
        await connection.execute(
            `REPLACE INTO pixel_it_telemetry 
                    (uuid, version, build_section, type, matrix, sensors, geoip, last_change)
                VALUES  
                    (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                telemetry.uuid,
                telemetry.version,
                telemetry.buildSection || '',
                telemetry.type,
                telemetry.matrix,
                telemetry.sensors,
                telemetry.geoip,
                new Date(),
            ]
        )
    } catch (error) {
        log.error('saveStats: {error}', { error: error })
    }
};

async function saveBMP(bmp) {
    try {
        bmp.userID = await getUserIDByName(bmp.userName);

        if (!bmp.userID) {
            bmp.userID = await createNewUser(bmp.userName);
        }

        await connection.execute(
            `insert into pixel_it_bitmap 
                    (datetime, name, rgb565array, sizex, sizey, userid, animated) 
                VALUES 
                    (?, ?, ?, ?, ?, ?, ?)`,
            [
                new Date(),
                bmp.name,
                bmp.rgb565array,
                bmp.sizeX,
                bmp.sizeY,
                bmp.userID,
                bmp.animated
            ]
        )
    } catch (error) {
        log.error('saveBMP: {error}', { error: error, bmp })
    }

    async function getUserIDByName(userName) {
        const result = await connection.query("Select id from pixel_it_user where name = ? and aktiv = true", [userName])
        console.log(JSON.stringify(result))
        return result[0][0]?.id;
    }

    async function createNewUser(userName) {
        await connection.execute("insert into pixel_it_user (name, aktiv) VALUES (?, ?)", [userName, true]);
        return await getUserIDByName(userName);
    }
}

async function isTelemetryUser(uuid) {
    let sqlResult
    try {
        sqlResult = await connection.query(`SELECT EXISTS(SELECT uuid FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY AND UUID = ? LIMIT 1) as isTelemetryUser`, uuid);
        return sqlResult[0][0].isTelemetryUser == 1
    } catch (error) {
        log.error('isTelemetryUser: {error}', { error: error })
        return false
    }
};

async function getUserMapData() {
    let sqlResult
    const result = [];
    try {
        sqlResult = await connection.query(`select JSON_EXTRACT(geoip, '$.ll') as coords from pixel_it_telemetry where  last_change >= CURRENT_DATE - INTERVAL 30 DAY`);

        for (const x of sqlResult[0]) {
            result.push(x.coords)
        }

        return result
    } catch (error) {
        log.error('getUserMapData: {error}', { error: error })
        return null
    }
};


async function getStatistics() {
    const result = {};
    try {
        result.buildStats = (await connection.query(`SELECT DISTINCT(IF(build_section = '','No_Data',build_section)) AS build, COUNT(*) AS count FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY GROUP BY build_section ORDER BY build`))[0];
        result.versionStats = (await connection.query(`SELECT DISTINCT(version) AS version, COUNT(*) AS count FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY GROUP BY version ORDER BY VERSION desc`))[0];
        result.matrixStats = (await connection.query(`SELECT DISTINCT(JSON_EXTRACT(matrix, '$.name')) AS matrix, COUNT(*) AS count FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY GROUP BY JSON_EXTRACT(matrix, '$.name') ORDER BY matrix`))[0];


        result.countryStats = (await connection.query(`SELECT DISTINCT(JSON_EXTRACT(geoip, '$.country')) AS country, COUNT(*) AS count FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY GROUP BY JSON_EXTRACT(geoip, '$.country') ORDER BY COUNT DESC`))[0];
        for (const countryStat of result.countryStats) {
            countryStat.country = countries.getName(countryStat.country, 'en', { select: 'official' });
        }

        const sensors = (await connection.query(`SELECT JSON_ARRAYAGG(sensors) as sensors FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY`))[0][0].sensors.flat(1);
        const sensorsDistinct = [...new Set(sensors)]
        result.sensorStats = [];
        for (const sensorDistinct of sensorsDistinct.sort()) {
            result.sensorStats.push({
                sensor: sensorDistinct,
                count: sensors.filter(x => x == sensorDistinct).length
            })
        }

        return result
    } catch (error) {
        log.error('getStatistics: {error}', { error: error })
        return null
    }
};

module.exports = {
    getBMPByID,
    getBMPByID_v2,
    getBMPAll,
    getBMPNewst,
    saveTelemetry,
    saveBMP,
    getUserMapData,
    getStatistics,
    isTelemetryUser,
};
