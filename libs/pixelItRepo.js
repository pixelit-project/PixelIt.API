
const mysql = require('mysql2/promise');
const tools = require('./tools')
const log = require('./logger')

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
    let result
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
        )

        result[0][0].animated = tools.mysqlToBool(result[0][0].animated)

        return result[0][0]
    } catch (error) {
        log.error('getBMPByID: {error}', { error: error })
        return null
    }
}

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
}

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

async function saveStats(telemetry) {
    try {
        await connection.execute(
            `REPLACE INTO pixel_it_telemetry 
                    (uuid, version, type, matrix, sensors, geoip, last_change)
                VALUES  
                    (?, ?, ?, ?, ?, ?, ?)`,
            [
                telemetry.uuid,
                telemetry.version,
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

async function getUserMapData() {
    let sqlResult
    const result = []
    try {
        sqlResult = await connection.query(
            `select JSON_EXTRACT(geoip, '$.ll') as coords from pixel_it_telemetry where  last_change >= CURRENT_DATE - INTERVAL 30 DAY`
        )

        for (const x of sqlResult[0]) {
            result.push(x.coords)
        }

        return result
    } catch (error) {
        log.error('getUserMapData: {error}', { error: error })
        return null
    }
}



module.exports = {
    getBMPByID,
    getBMPAll,
    getBMPNewst,
    getUserMapData,
    saveStats,
};
