let isSEQEnabled = true
let seqAPiKey = null

if (!process.env.SEQ_SERVER || process.env.SEQ_SERVER.length == 0) {
    isSEQEnabled = false
    console.warn(prepareLogForConsole('Warn', 'SEQ_SERVER not set', null, new Date()))
}

if (!process.env.SEQ_APIKEY || process.env.SEQ_APIKEY.length == 0) {
    console.warn(prepareLogForConsole('Warn', 'SEQ_APIKEY not set', null, new Date()))
} else {
    seqAPiKey = process.env.SEQ_APIKEY
    console.log(prepareLogForConsole('Info', 'SEQ_APIKEY set', null, new Date()))
}

// seq-logging 3 is an ES module. Keep the public logging API synchronous
// while retaining events emitted before the dynamic import has completed.
const logger = isSEQEnabled
    ? import('seq-logging').then(({ Logger }) => new Logger({
        serverUrl: process.env.SEQ_SERVER,
        apiKey: seqAPiKey,
    })).catch(error => {
        console.error('[Seq] Initialization failed:', error.message);
        return null;
    })
    : Promise.resolve(null);

function emitToSeq(event) {
    logger.then(instance => instance?.emit(event)).catch(error => {
        console.error('[Seq] Logging failed:', error.message);
    });
}

function enrichProperties(properties) {
    if (properties == null) {
        properties = {}
    }
    properties.Application = 'PixelIt.api'
    return properties
}

function prepareLogForConsole(lvl, message, properties, dateTime) {
    let extendedInformation = ''
    if (properties && properties.sourceIP) {
        extendedInformation += `[SourceIP: ${properties.sourceIP}`
        if (properties.useragent) {
            extendedInformation += `, UserAgent: ${properties.useragent.browser}`
        }
        if (properties.rateLimit) {
            extendedInformation += `, RateLimit: ${properties.rateLimit.current} of ${properties.rateLimit.limit} (${properties.rateLimit.remaining}) reset in ${(new Date(properties.rateLimit.resetTime).getTime() - Date.now()) / 1000}s`
        }
        extendedInformation += ']'
    }

    for (const key in properties) {
        if (properties.hasOwnProperty(key)) {
            message = message.replace(`{${key}}`, properties[key])
        }
    }
    return `[${dateTime.toISOString()}][${lvl}]${extendedInformation} ${message}`
}

module.exports = {
    close: async () => (await logger)?.close(),
    info: (message, properties) => {
        const dateTime = new Date()
        properties = enrichProperties(properties)
        console.log(prepareLogForConsole('Info', message, properties, dateTime))
        if (isSEQEnabled) {
            emitToSeq({
                timestamp: dateTime,
                level: 'Information',
                messageTemplate: message,
                properties: properties,
            })
        }
    },
    warn: (message, properties) => {
        const dateTime = new Date()
        properties = enrichProperties(properties)
        console.warn(prepareLogForConsole('Warn', message, properties, dateTime))
        if (isSEQEnabled) {
            emitToSeq({
                timestamp: dateTime,
                level: 'Warning',
                messageTemplate: message,
                properties: properties,
            })
        }
    },
    error: (message, properties) => {
        const dateTime = new Date()
        properties = enrichProperties(properties)
        console.error(prepareLogForConsole('Error', message, properties, dateTime))
        if (isSEQEnabled) {
            emitToSeq({
                timestamp: dateTime,
                level: 'Error',
                messageTemplate: message,
                properties: properties,
            })
        }
    },
}
