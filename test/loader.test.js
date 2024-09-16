import test from "ava";
import fs from "fs";
import path from "path";
import { satisfies } from "semver";
import createTestDirectory from "./helpers/createTestDirectory.js";
import { webpackAsync } from "./helpers/webpackAsync.js";

const outputDir = path.join(__dirname, "output/loader");
const babelLoader = path.join(__dirname, "../lib");
const globalConfig = {
  mode: "development",
  entry: path.join(__dirname, "fixtures/basic.js"),
  module: {
    rules: [
      {
        test: /\.jsx?/,
        loader: babelLoader,
        options: {
          targets: "chrome 42",
          presets: [["@babel/preset-env", { bugfixes: true, loose: true }]],
          configFile: false,
          babelrc: false,
        },
        exclude: /node_modules/,
      },
    ],
  },
};

// Create a separate directory for each test so that the tests
// can run in parallel
test.beforeEach(async t => {
  const directory = await createTestDirectory(outputDir, t.title);
  t.context.directory = directory;
});

test.afterEach(t =>
  fs.rmSync(t.context.directory, { recursive: true, force: true }),
);

test("should transpile the code snippet", async t => {
  const config = Object.assign({}, globalConfig, {
    output: {
      path: t.context.directory,
    },
  });

  const stats = await webpackAsync(config);
  t.deepEqual(stats.compilation.errors, []);
  t.deepEqual(stats.compilation.warnings, []);

  const files = fs.readdirSync(t.context.directory);
  t.true(files.length === 1);

  const test = "var App = function App(arg)";
  const subject = fs.readFileSync(
    path.resolve(t.context.directory, files[0]),
    "utf8",
  );

  t.true(subject.includes(test));
});

test("should not throw error on syntax error", async t => {
  const config = Object.assign({}, globalConfig, {
    entry: path.join(__dirname, "fixtures/syntax.js"),
    output: {
      path: t.context.directory,
    },
  });

  const stats = await webpackAsync(config);
  t.true(stats.compilation.errors.length === 1);
  t.true(stats.compilation.errors[0] instanceof Error);
  t.deepEqual(stats.compilation.warnings, []);
});

test("should not throw without config", async t => {
  const config = {
    mode: "development",
    entry: path.join(__dirname, "fixtures/basic.js"),
    output: {
      path: t.context.directory,
    },
    module: {
      rules: [
        {
          test: /\.jsx?/,
          use: babelLoader,
          exclude: /node_modules/,
        },
      ],
    },
  };

  const stats = await webpackAsync(config);
  t.deepEqual(stats.compilation.errors, []);
  t.deepEqual(stats.compilation.warnings, []);
});

test("should return compilation errors with the message included in the stack trace", async t => {
  const config = Object.assign({}, globalConfig, {
    entry: path.join(__dirname, "fixtures/syntax.js"),
    output: {
      path: t.context.directory,
    },
  });
  const stats = await webpackAsync(config);
  t.deepEqual(stats.compilation.warnings, []);
  const moduleBuildError = stats.compilation.errors[0];
  const babelLoaderError = moduleBuildError.error;
  t.regex(babelLoaderError.stack, /Unexpected token/);
});

test("should load ESM config files", async t => {
  const config = Object.assign({}, globalConfig, {
    entry: path.join(__dirname, "fixtures/constant.js"),
    output: {
      path: t.context.directory,
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          loader: babelLoader,
          exclude: /node_modules/,
          options: {
            // Use relative path starting with a dot to satisfy module loader.
            // https://github.com/nodejs/node/issues/31710
            // File urls doesn't work with current resolve@1.12.0 package.
            extends: (
              "." +
              path.sep +
              path.relative(
                process.cwd(),
                path.resolve(__dirname, "fixtures/babelrc.mjs"),
              )
            ).replace(/\\/g, "/"),
            babelrc: false,
          },
        },
      ],
    },
  });

  const stats = await webpackAsync(config);
  // Node supports ESM without a flag starting from 12.13.0 and 13.2.0.
  if (satisfies(process.version, `^12.13.0 || >=13.2.0`)) {
    t.deepEqual(
      stats.compilation.errors.map(e => e.message),
      [],
    );
  } else {
    t.is(stats.compilation.errors.length, 1);
    const moduleBuildError = stats.compilation.errors[0];
    const babelLoaderError = moduleBuildError.error;
    t.true(babelLoaderError instanceof Error);
    // Error messages are slightly different between versions:
    // "modules aren't supported" or "modules not supported".
    t.regex(babelLoaderError.message, /supported/i);
  }
  t.deepEqual(stats.compilation.warnings, []);
});

test("should track external dependencies", async t => {
  const dep = path.join(__dirname, "fixtures/metadata.js");
  const config = Object.assign({}, globalConfig, {
    entry: path.join(__dirname, "fixtures/constant.js"),
    output: {
      path: t.context.directory,
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          loader: babelLoader,
          options: {
            babelrc: false,
            configFile: false,
            plugins: [
              api => {
                api.cache.never();
                api.addExternalDependency(dep);
                return { visitor: {} };
              },
            ],
          },
        },
      ],
    },
  });

  const stats = await webpackAsync(config);
  t.true(stats.compilation.fileDependencies.has(dep));
  t.deepEqual(stats.compilation.warnings, []);
});

test("should output debug logs when stats.loggingDebug includes babel-loader", async t => {
  const config = Object.assign({}, globalConfig, {
    output: {
      path: t.context.directory,
    },
    stats: {
      loggingDebug: ["babel-loader"],
    },
  });

  const stats = await webpackAsync(config);
  t.regex(
    stats.toString(config.stats),
    /normalizing loader options\n\s+resolving Babel configs\n\s+cache is disabled, applying Babel transform/,
  );
});
