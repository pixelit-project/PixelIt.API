const NodeCache = require("node-cache");
const log = require("./logger");

const cache = new NodeCache({ stdTTL: 120, checkperiod: 600 });

async function getOrSet(key, dataFunction, lifeTime) {
  if (cache.has(key)) {
    const lifeTimeRemaining = (cache.getTtl(key) - Date.now()) / 1000;
    log.info(
      `Cache getOrSet: Key ${key} get from cache. Lifetime remaining: ${lifeTimeRemaining}s.`
    );

    return cache.get(key);
  } else {
    const value = await dataFunction();
    if (value != null) {
      log.info(
        `Cache getOrSet: Key ${key} set to cache with lifetime of ${
          lifeTime ? lifeTime + "s" : "default value"
        }.`,
        { key, lifeTime }
      );
      cache.set(key, value, lifeTime);
    }
    return value;
  }
}

module.exports = {
  getOrSet,
};
