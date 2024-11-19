const serialize = require("./serialize");
const transform = require("./transform");
const { promisify } = require("node:util");

/** @typedef {import("webpack").Compilation} Compilation */
/** @typedef {import("webpack").LoaderContext<{}>} LoaderContext */
/** @typedef {ReturnType<Compilation["getLogger"]>} WebpackLogger */
/** @typedef {ReturnType<Compilation["getCache"]>} CacheFacade */

const addTimestamps = async function (externalDependencies, getFileTimestamp) {
  for (const depAndEmptyTimestamp of externalDependencies) {
    try {
      const [dep] = depAndEmptyTimestamp;
      const { timestamp } = await getFileTimestamp(dep);
      depAndEmptyTimestamp.push(timestamp);
    } catch {
      // ignore errors if timestamp is not available
    }
  }
};

const areExternalDependenciesModified = async function (
  externalDepsWithTimestamp,
  getFileTimestamp,
) {
  for (const depAndTimestamp of externalDepsWithTimestamp) {
    const [dep, timestamp] = depAndTimestamp;
    let newTimestamp;
    try {
      newTimestamp = (await getFileTimestamp(dep)).timestamp;
    } catch {
      return true;
    }
    if (timestamp !== newTimestamp) {
      return true;
    }
  }
  return false;
};

/**
 * @this {LoaderContext}
 * @param {string} filename The input resource path
 * @param {string} source The input source
 * @param {object} options The Babel transform options
 * @param {CacheFacade} cacheFacade The webpack cache facade instance
 * @param {string} cacheIdentifier The extra cache identifier
 * @param {WebpackLogger} logger
 */
async function handleCache(
  filename,
  source,
  options = {},
  cacheFacade,
  cacheIdentifier,
  logger,
) {
  const getFileTimestamp = promisify((path, cb) => {
    this._compilation.fileSystemInfo.getFileTimestamp(path, cb);
  });
  const hash = this.utils.createHash(
    this._compilation.outputOptions.hashFunction,
  );
  const cacheKey = hash
    .update(serialize([options, source, cacheIdentifier]))
    .digest("hex");
  logger.debug(`getting cache for '${filename}', cachekey '${cacheKey}'`);

  const itemCache = cacheFacade.getItemCache(cacheKey, null);

  let result = await itemCache.getPromise();
  logger.debug(
    result ? `found cache for '${filename}'` : `missed cache for '${filename}'`,
  );
  if (result) {
    if (
      await areExternalDependenciesModified(
        result.externalDependencies,
        getFileTimestamp,
      )
    ) {
      logger.debug(
        `discarded cache for '${filename}' due to changes in external dependencies`,
      );
      result = null;
    }
  }

  if (!result) {
    logger.debug("applying Babel transform");
    result = await transform(source, options);
    await addTimestamps(result.externalDependencies, getFileTimestamp);
    logger.debug(`caching result for '${filename}'`);
    await itemCache.storePromise(result);
    logger.debug(`cached result for '${filename}'`);
  }

  return result;
}

module.exports = handleCache;
