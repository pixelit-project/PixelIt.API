
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

// Matrix names emitted by firmware GetTelemetry(), plus the corrected spelling.
// Extend this list when firmware introduces another supported configuration.
const validMatrixNames = [
    'Colum major',
    'Column major',
    'Row major',
    'Tiled 4x 8x8 CJMCU (Column major)',
    'MicroMatrix',
    'Tiled 4x 8x8 CJMCU (Row major)',
];
const matrixLabelSql = `
    CASE
        WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(matrix, '$.name')) AS BINARY)
            IN (${validMatrixNames.map(() => '?').join(', ')})
        THEN JSON_UNQUOTE(JSON_EXTRACT(matrix, '$.name'))
        ELSE 'Custom'
    END
`;

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
                            a.id = ? AND NOT EXISTS (SELECT 1 FROM pixel_it_reports r WHERE r.icon_id = a.id AND r.status = 'approved')`,
            id
        );
        if (result[0][0]) {
            result[0][0].animated = tools.mysqlToBool(result[0][0].animated);
            return result[0][0];
        }

    } catch (error) {
        log.error('getBMPByID: {error}', { error: error })
        throw error
    }
};

async function getBMPByID_v2(id) {
    let result;
    try {
        result = await getBMPByID(id);
        if (result) {
            if (result.animated == true) {
                result.rgB565Array = `[${result.rgB565Array}]`;
            }
            return result;
        }

    } catch (error) {
        log.error('getBMPByID_v2: {error}', { error: error })
        throw error
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
                        left outer join pixel_it_hitcount c on (a.id = c.pixel_id) WHERE NOT EXISTS (SELECT 1 FROM pixel_it_reports r WHERE r.icon_id = a.id AND r.status = 'approved')`)

        for (const bmp of result[0]) {
            bmp.animated = tools.mysqlToBool(bmp.animated)
        }

        return result[0]
    } catch (error) {
        log.error('getBMPAll: {error}', { error: error })
        throw error
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
                            NOT EXISTS (SELECT 1 FROM pixel_it_reports r WHERE r.icon_id = a.id AND r.status = 'approved') ORDER BY a.id DESC LIMIT 1`)

        if (!result[0][0]) return null;
        result[0][0].animated = tools.mysqlToBool(result[0][0].animated)

        return result[0][0]
    } catch (error) {
        log.error('getBMPNewst: {error}', { error: error })
        throw error
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
        log.error('saveTelemetry: {error}', { error: error });
        throw error;
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
        log.error('saveBMP: {error}', { error: error });
        throw error;
    }

    async function getUserIDByName(userName) {
        const result = await connection.query("Select id from pixel_it_user where name = ? and aktiv = true", [userName])
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
        throw error
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
        throw error
    }
};


async function getStatistics() {
    const result = {};
    try {
        result.buildStats = (await connection.query(`SELECT DISTINCT(IF(build_section = '','No_Data',build_section)) AS build, COUNT(*) AS count FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY GROUP BY build_section ORDER BY build`))[0];
        result.versionStats = (await connection.query(`SELECT DISTINCT(version) AS version, COUNT(*) AS count FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY GROUP BY version ORDER BY VERSION desc`))[0];
        result.matrixStats = (await connection.query(`
            SELECT ${matrixLabelSql} AS matrix, COUNT(*) AS count
            FROM pixel_it_telemetry
            WHERE last_change >= CURRENT_DATE - INTERVAL 30 DAY
            GROUP BY 1
            ORDER BY matrix
        `, validMatrixNames))[0];


        result.countryStats = (await connection.query(`SELECT DISTINCT(JSON_EXTRACT(geoip, '$.country')) AS country, COUNT(*) AS count FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY GROUP BY JSON_EXTRACT(geoip, '$.country') ORDER BY COUNT DESC`))[0];
        for (const countryStat of result.countryStats) {
            countryStat.country = countries.getName(countryStat.country, 'en', { select: 'official' });
        }

        const sensorRows = (await connection.query(`SELECT JSON_ARRAYAGG(sensors) as sensors FROM pixel_it_telemetry where last_change >= CURRENT_DATE - INTERVAL 30 DAY`))[0][0].sensors;
        const sensors = (sensorRows ?? []).flat(1).filter(sensor => typeof sensor === 'string');
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
        throw error
    }
};

// Only aggregate telemetry is exposed to administrators, never device UUIDs or locations.
async function getAdminStatistics() {
    const [summary] = await connection.query(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(last_change >= CURRENT_TIMESTAMP - INTERVAL 1 DAY), 0) AS active24h,
               COALESCE(SUM(last_change >= CURRENT_TIMESTAMP - INTERVAL 7 DAY), 0) AS active7d,
               COALESCE(SUM(last_change >= CURRENT_TIMESTAMP - INTERVAL 30 DAY), 0) AS active30d,
               MAX(last_change) AS lastSeen
        FROM pixel_it_telemetry
    `);
    const [versions] = await connection.query(`
        SELECT COALESCE(NULLIF(version, ''), 'Unbekannt') AS label, COUNT(*) AS count
        FROM pixel_it_telemetry
        WHERE last_change >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
        GROUP BY label
        ORDER BY count DESC, label ASC
        LIMIT 8
    `);
    const [hardware] = await connection.query(`
        SELECT COALESCE(NULLIF(type, ''), 'Unbekannt') AS label, COUNT(*) AS count
        FROM pixel_it_telemetry
        WHERE last_change >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
        GROUP BY label
        ORDER BY count DESC, label ASC
        LIMIT 8
    `);
    const [matrices] = await connection.query(`
        SELECT ${matrixLabelSql} AS label,
               COUNT(*) AS count
        FROM pixel_it_telemetry
        WHERE last_change >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
        GROUP BY label
        ORDER BY count DESC, label ASC
        LIMIT 8
    `, validMatrixNames);
    const totals = summary[0] || {};
    return {
        total: Number(totals.total || 0),
        active24h: Number(totals.active24h || 0),
        active7d: Number(totals.active7d || 0),
        active30d: Number(totals.active30d || 0),
        lastSeen: totals.lastSeen || null,
        versions: versions.map(row => ({ label: row.label, count: Number(row.count) })),
        hardware: hardware.map(row => ({ label: row.label, count: Number(row.count) })),
        matrices: matrices.map(row => ({ label: row.label, count: Number(row.count) })),
        generatedAt: new Date().toISOString(),
    };
}

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
    getAdminStatistics,
};
