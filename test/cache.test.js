import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import webpack from "webpack";
import { webpackAsync } from "./helpers/webpackAsync.js";
import createTestDirectory from "./helpers/createTestDirectory.js";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultCacheDir = path.join(__dirname, "../node_modules/.cache/webpack");
const cacheDir = path.join(__dirname, "output/cache/cachefiles");
const outputDir = path.join(__dirname, "output/cache");
const babelLoader = path.join(__dirname, "../lib");

const globalConfig = {
  mode: "development",
  entry: path.join(__dirname, "fixtures/basic.js"),
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: babelLoader,
        exclude: /node_modules/,
      },
    ],
  },
};

// example: 0.pack, index.pack
const UNCOMPRESSED_CACHE_FILE_REGEX = /.+\.pack$/;
// example: 0.pack.gz, index.pack.gz
const CACHE_FILE_REGEX = /.+\.pack\.gz$/;

// Create a separate directory for each test so that the tests
// can run in parallel

const context = { directory: undefined, cacheDirectory: undefined };

test.beforeEach(async t => {
  const directory = await createTestDirectory(outputDir, t.name);
  context.directory = directory;
  const cacheDirectory = await createTestDirectory(cacheDir, t.name);
  context.cacheDirectory = cacheDirectory;
});
test.beforeEach(() =>
  fs.rmSync(defaultCacheDir, { recursive: true, force: true }),
);
test.afterEach(() => {
  fs.rmSync(defaultCacheDir, { recursive: true, force: true });
  fs.rmSync(context.directory, { recursive: true, force: true });
  fs.rmSync(context.cacheDirectory, { recursive: true, force: true });
});

test("should output files to cache directory when cache type is filesystem", async () => {
  const config = Object.assign({}, globalConfig, {
    cache: {
      type: "filesystem",
      cacheDirectory: context.cacheDirectory,
    },
    output: {
      path: context.directory,
    },
    module: {
      rules: [
        {
          test: /\.jsx?/,
          exclude: /node_modules/,
          use: [
            {
              loader: babelLoader,
              options: {
                cacheDirectory: true,
                presets: ["@babel/preset-env"],
              },
            },
            // when cache.type is filesystem, webpack will try to cache the loader result if they
            // are cacheable (by default). The webpack cache will then be hit before the babel-loader
            // cache. To test the babel-loader cache behaviour, we have to mark the loader results
            // as uncacheable
            {
              loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
            },
          ],
        },
      ],
    },
  });

  const stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);

  const files = fs.readdirSync(context.cacheDirectory);
  assert.ok(files.length > 0);
});

test("should output pack.gz files to standard cache dir when cache.compression is gzip", async () => {
  const config = Object.assign({}, globalConfig, {
    cache: {
      type: "filesystem",
      compression: "gzip",
    },
    output: {
      path: context.directory,
    },
    module: {
      rules: [
        {
          test: /\.jsx?/,
          exclude: /node_modules/,
          use: [
            {
              loader: babelLoader,
              options: {
                cacheDirectory: true,
                presets: ["@babel/preset-env"],
              },
            },
            {
              loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
            },
          ],
        },
      ],
    },
  });

  const stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);

  let files = fs.readdirSync(defaultCacheDir, { recursive: true });
  files = files.filter(file => CACHE_FILE_REGEX.test(file));
  assert.ok(files.length > 0);
});

test("should output non-compressed files to standard cache dir when cache.compression is set to false", async () => {
  const config = Object.assign({}, globalConfig, {
    cache: {
      type: "filesystem",
      compression: false,
    },
    output: {
      path: context.directory,
    },
    module: {
      rules: [
        {
          test: /\.jsx?/,
          loader: babelLoader,
          exclude: /node_modules/,
          options: {
            cacheDirectory: true,
            presets: ["@babel/preset-env"],
            configFile: false,
          },
        },
      ],
    },
  });

  await webpackAsync(config);
  let files = fs.readdirSync(defaultCacheDir, { recursive: true });
  files = files.filter(file => UNCOMPRESSED_CACHE_FILE_REGEX.test(file));
  assert.ok(files.length > 0);
});

test("should read from cache directory if cached exists", async () => {
  const config = Object.assign({}, globalConfig, {
    cache: {
      type: "filesystem",
    },
    output: {
      path: context.directory,
    },
    module: {
      rules: [
        {
          test: /\.jsx?/,
          exclude: /node_modules/,
          use: [
            {
              loader: babelLoader,
              options: {
                cacheDirectory: true,
                presets: ["@babel/preset-env"],
                configFile: false,
              },
            },
            {
              loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
            },
          ],
        },
      ],
    },
    stats: {
      loggingDebug: ["babel-loader"],
    },
  });

  let stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.match(
    stats.toString(config.stats),
    /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+missed cache for.+\n\s+applying Babel transform\n\s+caching result for.+\n\s+cached result for.+\n/,
    "The first run stat does not match the snapshot regex",
  );
  let files = fs.readdirSync(defaultCacheDir, { recursive: true });
  files = files.filter(file => UNCOMPRESSED_CACHE_FILE_REGEX.test(file));
  assert.ok(files.length > 0);

  stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.match(
    stats.toString(config.stats),
    /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+found cache for.+\n/,
    "The second run stat does not match the snapshot regex",
  );
});

test("should not reuse cache if the identifier changes", async () => {
  const configFactory = cacheIdentifier =>
    Object.assign({}, globalConfig, {
      cache: {
        type: "filesystem",
      },
      output: {
        path: context.directory,
      },
      module: {
        rules: [
          {
            test: /\.jsx?/,
            exclude: /node_modules/,
            use: [
              {
                loader: babelLoader,
                options: {
                  cacheDirectory: true,
                  cacheIdentifier,
                  presets: ["@babel/preset-env"],
                  configFile: false,
                },
              },
              {
                loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
              },
            ],
          },
        ],
      },
      stats: {
        loggingDebug: ["babel-loader"],
      },
    });

  let config = configFactory("a");
  let stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.match(
    stats.toString(config.stats),
    /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+missed cache for.+\n\s+applying Babel transform\n\s+caching result for.+\n\s+cached result for.+/,
    "The first run stat does not match the snapshot regex",
  );
  let files = fs.readdirSync(defaultCacheDir, { recursive: true });
  files = files.filter(file => UNCOMPRESSED_CACHE_FILE_REGEX.test(file));
  assert.ok(files.length > 0);

  config = configFactory("b");
  stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.match(
    stats.toString(config.stats),
    /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+missed cache for.+\n\s+applying Babel transform\n\s+caching result for.+\n\s+cached result for.+/,
    "The second run stat does not match the snapshot regex",
  );
  files = fs.readdirSync(defaultCacheDir, { recursive: true });
  files = files.filter(file => UNCOMPRESSED_CACHE_FILE_REGEX.test(file));
  assert.ok(files.length > 0);
});

test("should allow to specify the .babelrc file", async () => {
  const configs = [
    Object.assign({}, globalConfig, {
      entry: path.join(__dirname, "fixtures/constant.js"),
      cache: {
        type: "filesystem",
        cacheDirectory: context.cacheDirectory,
      },
      output: {
        path: context.directory,
      },
      module: {
        rules: [
          {
            test: /\.jsx?/,
            exclude: /node_modules/,
            use: [
              {
                loader: babelLoader,
                options: {
                  cacheDirectory: true,
                  extends: path.join(__dirname, "fixtures/babelrc"),
                  babelrc: false,
                  presets: ["@babel/preset-env"],
                  configFile: false,
                },
              },
              {
                loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
              },
            ],
          },
        ],
      },
      stats: {
        loggingDebug: ["babel-loader"],
      },
    }),
    Object.assign({}, globalConfig, {
      cache: {
        type: "filesystem",
        cacheDirectory: context.cacheDirectory,
      },
      entry: path.join(__dirname, "fixtures/constant.js"),
      output: {
        path: context.directory,
      },
      module: {
        rules: [
          {
            test: /\.jsx?/,
            exclude: /node_modules/,
            use: [
              {
                loader: babelLoader,
                options: {
                  cacheDirectory: true,
                  presets: ["@babel/preset-env"],
                  configFile: false,
                },
              },
              {
                loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
              },
            ],
          },
        ],
      },
      stats: {
        loggingDebug: ["babel-loader"],
      },
    }),
  ];
  let stats = await webpackAsync(configs[0]);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.match(
    stats.toString(configs[0].stats),
    /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+missed cache for.+\n\s+applying Babel transform\n\s+caching result for.+\n\s+cached result for.+\s+added '.+fixtures[\\/]babelrc' to webpack dependencies/,
    "The first run stat does not match the snapshot regex",
  );

  // The cache is reused because the two configs resolved to same Babel
  // config as "fixtures/babelrc" is { "presets": ["@babel/preset-env"] }
  stats = await webpackAsync(configs[1]);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.match(
    stats.toString(configs[1].stats),
    /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+found cache for.+\n/,
    "The second run stat does not match the snapshot regex",
  );
});

test("should cache result when there are external dependencies", async () => {
  const dep = path.join(cacheDir, "externalDependency.txt");

  fs.writeFileSync(dep, "first update");

  let counter = 0;

  const config = Object.assign({}, globalConfig, {
    cache: {
      type: "filesystem",
      cacheDirectory: context.cacheDirectory,
    },
    entry: path.join(__dirname, "fixtures/constant.js"),
    output: {
      path: context.directory,
    },
    module: {
      rules: [
        {
          test: /\.jsx?/,
          exclude: /node_modules/,
          use: [
            {
              loader: babelLoader,
              options: {
                babelrc: false,
                configFile: false,
                cacheDirectory: true,
                plugins: [
                  api => {
                    api.cache.never();
                    api.addExternalDependency(dep);
                    return {
                      visitor: {
                        BooleanLiteral(path) {
                          counter++;
                          path.replaceWith(
                            api.types.stringLiteral(
                              fs.readFileSync(dep, "utf8"),
                            ),
                          );
                          path.stop();
                        },
                      },
                    };
                  },
                ],
              },
            },
            {
              loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
            },
          ],
        },
      ],
    },
  });

  let stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.deepEqual(stats.compilation.errors, []);

  assert.ok(stats.compilation.fileDependencies.has(dep));
  assert.strictEqual(counter, 1);

  stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.deepEqual(stats.compilation.errors, []);

  assert.ok(stats.compilation.fileDependencies.has(dep));
  assert.strictEqual(counter, 1);

  fs.writeFileSync(dep, "second update");
  stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.deepEqual(stats.compilation.errors, []);

  assert.ok(stats.compilation.fileDependencies.has(dep));
  assert.strictEqual(counter, 2);
});

test("should burst cache when the external dependency is removed from filesystem", async () => {
  const dep = path.join(cacheDir, "externalDependency.txt");

  fs.writeFileSync(dep, "first update");

  let counter = 0;

  const config = Object.assign({}, globalConfig, {
    cache: {
      type: "filesystem",
      cacheDirectory: context.cacheDirectory,
    },
    entry: path.join(__dirname, "fixtures/constant.js"),
    output: {
      path: context.directory,
    },
    module: {
      rules: [
        {
          test: /\.jsx?/,
          exclude: /node_modules/,
          use: [
            {
              loader: babelLoader,
              options: {
                babelrc: false,
                configFile: false,
                cacheDirectory: true,
                plugins: [
                  api => {
                    api.cache.never();
                    api.addExternalDependency(dep);
                    return {
                      visitor: {
                        BooleanLiteral(path) {
                          counter++;
                          let depContent = "dep is removed";
                          try {
                            depContent = fs.readFileSync(dep, "utf8");
                          } catch {
                            // ignore if dep is removed
                          }
                          path.replaceWith(api.types.stringLiteral(depContent));
                          path.stop();
                        },
                      },
                    };
                  },
                ],
              },
            },
            {
              loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
            },
          ],
        },
      ],
    },
  });

  let stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.deepEqual(stats.compilation.errors, []);

  assert.ok(stats.compilation.fileDependencies.has(dep));
  assert.strictEqual(counter, 1);

  stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.deepEqual(stats.compilation.errors, []);

  assert.ok(stats.compilation.fileDependencies.has(dep));
  assert.strictEqual(counter, 1);

  fs.rmSync(dep);
  stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.warnings, []);
  assert.deepEqual(stats.compilation.errors, []);

  assert.ok(stats.compilation.fileDependencies.has(dep));
  assert.strictEqual(counter, 2);
});

test("should work with memory type webpack cache", async () => {
  const config = Object.assign({}, globalConfig, {
    cache: {
      type: "memory",
    },
    output: {
      path: context.directory,
    },
    module: {
      rules: [
        {
          test: /\.jsx?/,
          exclude: /node_modules/,
          use: [
            {
              loader: babelLoader,
              options: {
                cacheDirectory: true,
                configFile: false,
                presets: ["@babel/preset-env"],
              },
            },
            {
              loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
            },
          ],
        },
      ],
    },
    stats: {
      loggingDebug: ["babel-loader"],
    },
  });

  return new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((err, stats) => {
      if (err) reject(err);
      assert.match(
        stats.toString(config.stats),
        /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+missed cache for.+\n\s+applying Babel transform\n\s+caching result for.+\n\s+cached result for.+/,
        "The first run stat does not match the snapshot regex",
      );
      compiler.run((err, newStats) => {
        if (err) reject(err);
        assert.match(
          newStats.toString(config.stats),
          /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+found cache for.+/,
          "The second run stat does not match the snapshot regex",
        );
        resolve();
      });
    });
  });
});

test("it should work with custom webpack cache plugin", async () => {
  class CustomCachePlugin {
    /**
     * Apply the plugin
     * @param {import("webpack").Compiler} compiler the compiler instance
     */
    apply(compiler) {
      let cache = Object.create(null);
      const pluginName = this.constructor.name;

      compiler.cache.hooks.store.tap(pluginName, (identifier, etag, data) => {
        cache[identifier] = { etag, data };
      });

      compiler.cache.hooks.get.tap(
        pluginName,
        (identifier, etag, gotHandlers) => {
          if (!(identifier in cache)) {
            return null;
          } else if (cache[identifier] != null) {
            const cacheEntry = cache[identifier];
            if (cacheEntry.etag === etag) {
              return cacheEntry.data;
            } else {
              return null;
            }
          }
          gotHandlers.push((result, callback) => {
            if (result === undefined) {
              cache[identifier] = null;
            } else {
              cache[identifier] = { etag, data: result };
            }
            return callback();
          });
        },
      );

      compiler.cache.hooks.shutdown.tap(
        pluginName,
        () => (cache = Object.create(null)),
      );
    }
  }

  const config = Object.assign({}, globalConfig, {
    // disable builtin webpack cache so that CustomCachePlugin can provide the cache backend
    cache: false,
    entry: path.join(__dirname, "fixtures/constant.js"),
    output: {
      path: context.directory,
    },
    module: {
      rules: [
        {
          test: /\.jsx?/,
          exclude: /node_modules/,
          use: [
            {
              loader: babelLoader,
              options: {
                cacheDirectory: true,
                configFile: false,
                presets: ["@babel/preset-env"],
              },
            },
            {
              loader: "./test/fixtures/uncacheable-passthrough-loader.cjs",
            },
          ],
        },
      ],
    },
    plugins: [new CustomCachePlugin()],
    stats: {
      loggingDebug: ["babel-loader", CustomCachePlugin.name],
    },
  });

  return new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((err, stats) => {
      if (err) reject(err);
      assert.match(
        stats.toString(config.stats),
        /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+missed cache for.+\n\s+applying Babel transform\n\s+caching result for.+\n\s+cached result for.+/,
        "The first run stat does not match the snapshot regex",
      );
      compiler.run((err, newStats) => {
        if (err) reject(err);
        assert.match(
          newStats.toString(config.stats),
          /normalizing loader options\n\s+resolving Babel configs\n\s+cache is enabled\n\s+getting cache for.+\n\s+found cache for.+/,
          "The second run stat does not match the snapshot regex",
        );
        resolve();
      });
    });
  });
});
