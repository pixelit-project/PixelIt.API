
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
                            a.id = ? AND NOT EXISTS (SELECT 1 FROM pixel_it_reports r WHERE r.icon_id = a.id AND r.status = 'blocked')`,
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
                        left outer join pixel_it_hitcount c on (a.id = c.pixel_id) WHERE NOT EXISTS (SELECT 1 FROM pixel_it_reports r WHERE r.icon_id = a.id AND r.status IN ('approved', 'blocked'))`)

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
                            NOT EXISTS (SELECT 1 FROM pixel_it_reports r WHERE r.icon_id = a.id AND r.status = 'blocked') ORDER BY a.id DESC LIMIT 1`)

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

async function getIconRatings(uuid, iconId, database = connection) {
    const values = [uuid];
    if (iconId !== undefined) {
        values.push(iconId);
    }
    const [rows] = await database.execute(`
        SELECT ratings.icon_id AS iconId,
               AVG(ratings.stars) AS average,
               COUNT(*) AS count,
               MAX(CASE WHEN ratings.voter_uuid = UNHEX(?) THEN ratings.stars END) AS myRating
        FROM pixel_it_icon_ratings ratings
        JOIN pixel_it_bitmap bitmap ON bitmap.id = ratings.icon_id
        WHERE NOT EXISTS (
            SELECT 1 FROM pixel_it_reports report
            WHERE report.icon_id = bitmap.id AND report.status = 'blocked'
        )
        ${iconId === undefined ? '' : 'AND ratings.icon_id = ?'}
        GROUP BY ratings.icon_id
    `, values);
    return rows.map(row => ({
        iconId: Number(row.iconId),
        average: Number(row.average),
        count: Number(row.count),
        myRating: row.myRating === null ? null : Number(row.myRating),
    }));
}

async function rateIcon(iconId, uuid, stars) {
    const database = await connection.getConnection();
    try {
        await database.beginTransaction();
        await database.execute(`
            INSERT INTO pixel_it_icon_ratings (icon_id, voter_uuid, stars)
            SELECT bitmap.id, UNHEX(?), ?
            FROM pixel_it_bitmap bitmap
            WHERE bitmap.id = ? AND NOT EXISTS (
                SELECT 1 FROM pixel_it_reports report
                WHERE report.icon_id = bitmap.id AND report.status = 'blocked'
            )
            ON DUPLICATE KEY UPDATE stars = ?
        `, [uuid, stars, iconId, stars]);
        const [rating] = await getIconRatings(uuid, iconId, database);
        if (!rating?.myRating) {
            await database.rollback();
            return null;
        }
        await database.execute(`
            INSERT INTO pixel_it_icon_rating_submissions (day, submission_count)
            VALUES (UTC_DATE(), 1)
            ON DUPLICATE KEY UPDATE submission_count = submission_count + 1
        `);
        await database.commit();
        return rating;
    } catch (error) {
        await database.rollback();
        throw error;
    } finally {
        database.release();
    }
}

async function recordIconDownload(iconId) {
    await connection.execute(`
        INSERT INTO pixel_it_icon_downloads (day, icon_id, request_count)
        VALUES (UTC_DATE(), ?, 1)
        ON DUPLICATE KEY UPDATE request_count = request_count + 1
    `, [iconId]);
}

function getUtcDateRange(days) {
    const today = new Date();
    const through = today.toISOString().slice(0, 10);
    today.setUTCDate(today.getUTCDate() - days + 1);
    return { since: today.toISOString().slice(0, 10), through };
}

async function getIconDownloads(days) {
    const { since, through } = getUtcDateRange(days);
    const [daily] = await connection.execute(`
        SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, SUM(request_count) AS count
        FROM pixel_it_icon_downloads
        WHERE day BETWEEN ? AND ?
        GROUP BY day
        ORDER BY day
    `, [since, through]);
    const [top] = await connection.execute(`
        SELECT counts.icon_id AS iconId, bitmap.name, SUM(counts.request_count) AS count
        FROM pixel_it_icon_downloads counts
        LEFT JOIN pixel_it_bitmap bitmap ON bitmap.id = counts.icon_id
        WHERE counts.day BETWEEN ? AND ?
        GROUP BY counts.icon_id, bitmap.name
        ORDER BY count DESC, counts.icon_id
        LIMIT 20
    `, [since, through]);
    return {
        days,
        through,
        daily: daily.map(({ day, count }) => ({ day, count: Number(count) })),
        top: top.map(({ iconId, name, count }) => ({ iconId, name, count: Number(count) })),
    };
}

async function getAdminIconRatings(days) {
    const { since, through } = getUtcDateRange(days);
    const [daily] = await connection.execute(`
        SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, submission_count AS count
        FROM pixel_it_icon_rating_submissions
        WHERE day BETWEEN ? AND ?
        ORDER BY day
    `, [since, through]);
    const [distribution] = await connection.execute(`
        SELECT stars, COUNT(*) AS count
        FROM pixel_it_icon_ratings
        GROUP BY stars
        ORDER BY stars DESC
    `);
    const [rankedIcons] = await connection.execute(`
        WITH rated_icons AS (
            SELECT icon_id, AVG(stars) AS average, COUNT(*) AS count
            FROM pixel_it_icon_ratings
            GROUP BY icon_id
        ), rankings AS (
            SELECT icon_id, average, count,
                   ROW_NUMBER() OVER (ORDER BY count DESC, icon_id) AS mostRank,
                   ROW_NUMBER() OVER (ORDER BY average DESC, count DESC, icon_id) AS bestRank,
                   ROW_NUMBER() OVER (ORDER BY average ASC, count DESC, icon_id) AS worstRank
            FROM rated_icons
        )
        SELECT rankings.icon_id AS iconId, bitmap.name, average, count,
               mostRank, bestRank, worstRank
        FROM rankings
        LEFT JOIN pixel_it_bitmap bitmap ON bitmap.id = rankings.icon_id
        WHERE mostRank <= 20 OR bestRank <= 10 OR worstRank <= 10
    `);
    const stars = [5, 4, 3, 2, 1].map(stars => ({
        stars,
        count: Number(distribution.find(row => Number(row.stars) === stars)?.count ?? 0),
    }));
    const total = stars.reduce((sum, entry) => sum + entry.count, 0);
    function selectRanking(rank, limit) {
        return rankedIcons.filter(row => row[rank] <= limit)
            .sort((first, second) => first[rank] - second[rank])
            .map(({ iconId, name, average, count }) => ({
                iconId, name, average: Number(average), count: Number(count),
            }));
    }
    return {
        total,
        average: total ? stars.reduce((sum, entry) => sum + entry.stars * entry.count, 0) / total : null,
        stars,
        days,
        through,
        daily: daily.map(({ day, count }) => ({ day, count: Number(count) })),
        mostRated: selectRanking('mostRank', 20),
        bestRated: selectRanking('bestRank', 10),
        worstRated: selectRanking('worstRank', 10),
    };
}

module.exports = {
    getAdminIconRatings,
    recordIconDownload,
    getIconDownloads,
    getBMPByID,
    getBMPByID_v2,
    getBMPAll,
    getIconRatings,
    rateIcon,
    getBMPNewst,
    saveTelemetry,
    saveBMP,
    getUserMapData,
    getStatistics,
    isTelemetryUser,
    getAdminStatistics,
};
