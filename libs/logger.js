const seq = require('seq-logging');
let isSEQEnabled = true;
let seqAPiKey = null;

if (!process.env.SEQ_SERVER || process.env.SEQ_SERVER.length == 0) {
    isSEQEnabled = false;
    console.warn(prepareLogForConsole('SEQ_SERVER not set', null, new Date()));
}

if (!process.env.SEQ_APIKEY || process.env.SEQ_APIKEY.length == 0) {
    console.warn(prepareLogForConsole('SEQ_APIKEY not set', null, new Date()));
} else {
    seqAPiKey = process.env.SEQ_APIKEY;
    console.log(prepareLogForConsole('SEQ_APIKEY set', null, new Date()));
}

const logger = new seq.Logger({
    serverUrl: process.env.SEQ_SERVER,
    apiKey: seqAPiKey
});

function enrichProperties(properties) {
    if (properties == null) {
        properties = {};
    }
    properties.Application = 'PixelIt.api';
    return properties;
};

function prepareLogForConsole(message, properties, dateTime) {
    let extendedInformation = '';
    if (properties && properties.sourceIP) {
        extendedInformation += `[SourceIP: ${properties.sourceIP}`;
        if (properties.useragent) {
            extendedInformation += `, UserAgent: ${properties.useragent.browser}`;
        }
        extendedInformation += ']';
    }

    for (const key in properties) {
        if (properties.hasOwnProperty(key)) {
            message = message.replace(`{${key}}`, properties[key]);
        }
    }
    return `[${dateTime.toISOString().slice(0, 10)}T${dateTime.toLocaleTimeString()}]${extendedInformation} ${message}`;
}

module.exports = {
    info: (message, properties) => {
        const dateTime = new Date();
        properties = enrichProperties(properties);
        console.log(prepareLogForConsole(message, properties, dateTime));
        if (isSEQEnabled) {
            logger.emit({
                timestamp: dateTime,
                level: 'Information',
                messageTemplate: message,
                properties: properties
            });
        }
    },
    warn: (message, properties) => {
        const dateTime = new Date();
        properties = enrichProperties(properties);
        console.warn(prepareLogForConsole(message, properties, dateTime));
        if (isSEQEnabled) {
            logger.emit({
                timestamp: dateTime,
                level: 'Warning',
                messageTemplate: message,
                properties: properties,
            });
        }
    },
    error: (message, properties) => {
        const dateTime = new Date();
        properties = enrichProperties(properties);
        console.error(prepareLogForConsole(message, properties, dateTime));
        if (isSEQEnabled) {
            logger.emit({
                timestamp: dateTime,
                level: 'Error',
                messageTemplate: message,
                properties: properties
            });
        }
    },
}