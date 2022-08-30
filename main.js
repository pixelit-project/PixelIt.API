const express = require('express')
const useragent = require('express-useragent')
const bodyParser = require('body-parser')
const cors = require('cors')
const helmet = require('helmet')
const mysql = require('mysql2/promise')
const log = require('./libs/logger')
const tools = require('./libs/tools')
const cache = require('./libs/cache')
const geoip = require('fast-geoip')
const axios = require('axios').default

const connection = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
})

const repo = require('./libs/pixelItRepo')(connection, log)
const port = process.env.PORT || 8080

// defining the Express app
const app = express()
app.use(useragent.express())
// adding Helmet to enhance your Rest API's security
app.use(helmet())
// using bodyParser to parse JSON bodies into JS objects
app.use(bodyParser.json())
// enabling CORS for all requests
app.use(cors())

app.get('/api/GetBMPByID/:id', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req)
    const rawUrl = tools.getRawURLFromRequest(req)
    const id = req.params.id
    const bmp =
        (await cache.getOrSet(
            `GetBMPByID_${id}`,
            () => {
                return repo.getBMPByID(id)
            },
            0
        )) ?? {}

    log.info(
        'GetBMPByID: BMP with ID {id} and name {name} successfully delivered',
        {
            id: bmp.id,
            name: bmp.name,
            sourceIP: sourceIP,
            rawUrl: rawUrl,
            useragent: req.useragent,
        }
    )
    res.send(bmp)
})

app.get('/api/GetBMPNewst', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req)
    const rawUrl = tools.getRawURLFromRequest(req)
    const bmp =
        (await cache.getOrSet(
            'GetBMPNewst',
            () => {
                return repo.getBMPNewst()
            },
            30
        )) ?? {}

    res.send(bmp)
})

app.get('/api/GetBMPAll', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req)
    const rawUrl = tools.getRawURLFromRequest(req)
    const bmps =
        (await cache.getOrSet(
            'GetBMPAll',
            () => {
                return repo.getBMPAll()
            },
            30
        )) ?? []

    log.info('GetBMPAll: {count} BMPs successfully delivered', {
        count: bmps.length,
        sourceIP: sourceIP,
        rawUrl: rawUrl,
        useragent: req.useragent,
    })
    res.send(bmps)
})

app.post('/api/Telemetry', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req)
    const rawUrl = tools.getRawURLFromRequest(req)

    if (!req.body) {
        log.error('Telemetry: No body found', {
            sourceIP: sourceIP,
            rawUrl: rawUrl,
            useragent: req.useragent,
        })
        res.status(400).send('Not valid body')
        return
    }

    ;(async () => {
        req.body.geoip = await geoip.lookup(sourceIP)
        log.info(`Telemetry: ${JSON.stringify(req.body)}`, {
            sourceIP: sourceIP,
            rawUrl: rawUrl,
            useragent: req.useragent,
        })
        repo.saveStats(req.body)
    })()

    res.sendStatus(200)
})

app.get('/api/GetUserMapData', async (req, res) => {
    const sourceIP = tools.getIPFromRequest(req)
    const rawUrl = tools.getRawURLFromRequest(req)
    const userMapData =
        (await cache.getOrSet(
            'GetUserMapData',
            () => {
                return repo.getUserMapData()
            },
            30
        )) ?? []

    log.info('GetUserMapData: {count} User successfully delivered', {
        count: userMapData.length,
        sourceIP: sourceIP,
        rawUrl: rawUrl,
        useragent: req.useragent,
    })
    res.send(userMapData)
})

app.get('/api/LastRelease', async (req, res) => {
    const lastReleaseData = await cache.getOrSet('LastRelease', () => {
        return axios
            .get(
                'https://api.github.com/repos/pixelit-project/PixelIt/releases'
            )
            .then((resp) => {
                var keys = [
                    'node_id',
                    'tag_name',
                    'target_commitish',
                    'name',
                    'draft',
                    'prerelease',
                    'created_at',
                    'published_at',
                ]
                return Object.fromEntries(
                    Object.entries(resp.data[0]).filter(([key]) =>
                        keys.includes(key)
                    )
                )
            })
    })

    res.send(lastReleaseData)
})

// starting the server
app.listen(port, () => {
    log.info('API listening on port {port}', {
        port: port,
    })
})
