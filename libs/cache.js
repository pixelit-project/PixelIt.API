const NodeCache = require('node-cache');
const log = require('./logger');

const cache = new NodeCache({ stdTTL: 120, checkperiod: 600 });

let generation = 0;
async function getOrSet(key, dataFunction, lifeTime) {
    if (cache.has(key)) {
        const lifeTimeRemaining = (cache.getTtl(key) - Date.now()) / 1000;
        log.info(
            `Cache getOrSet: Key {key} get from cache. Lifetime remaining: ${
                lifeTime != null && lifeTime > 0 ? `{lifeTimeRemaining}s` : 'unlimited'
            }`,
            { key, lifeTimeRemaining }
        );
        return cache.get(key);
    } else {
        const started = generation;
        const value = await dataFunction();
        if (value != null && started === generation) {
            log.info(
                `Cache getOrSet: Key {key} set to cache with lifetime of ${
                    lifeTime != null ? `${lifeTime > 0 ? `{lifeTime}s` : 'unlimited'}` : 'default value'
                }.`,
                { key, lifeTime }
            );
            cache.set(key, value, lifeTime);
        }
        return value;
    }
}

function invalidateBitmaps() {
    generation++;
    const bitmapKeys = cache.keys().filter((key) => key.startsWith('GetBMP'));
    cache.del(bitmapKeys);
    log.info('Bitmap caches invalidated: {count} entries removed.', { count: bitmapKeys.length });
}

module.exports = {
    getOrSet,
    invalidateBitmaps,
};
