import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import createTestDirectory from "./helpers/createTestDirectory.js";
import { webpackAsync } from "./helpers/webpackAsync.js";
import webpack from "webpack";
const { NormalModule } = webpack;
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "output/metadata");
const babelLoader = path.join(__dirname, "../lib");

function babelMetadataProvierPlugin() {
  return {
    name: "babel-metadata-provider-plugin",
    visitor: {
      Program(_, pass) {
        pass.file.metadata = { hello: "world" };
      },
    },
  };
}

class WebpackMetadataSubscriberPlugin {
  static subscriber = Symbol("subscriber");
  constructor(subscriberCallback) {
    this.subscriberCallback = subscriberCallback;
  }
  apply(compiler) {
    compiler.hooks.compilation.tap("plugin", compilation => {
      NormalModule.getCompilationHooks(compilation).loader.tap(
        "plugin",
        context => {
          context[WebpackMetadataSubscriberPlugin.subscriber] =
            this.subscriberCallback;
        },
      );
    });
  }
}

// Create a separate directory for each test so that the tests
// can run in parallel
const context = { directory: undefined };
test.beforeEach(async t => {
  const directory = await createTestDirectory(outputDir, t.name);
  context.directory = directory;
});

test.afterEach(() =>
  fs.rmSync(context.directory, { recursive: true, force: true }),
);

test("should obtain metadata from the transform result", async () => {
  let actualMetadata;

  const config = {
    mode: "development",
    entry: "./test/fixtures/basic.js",
    output: {
      path: context.directory,
      filename: "[id].metadata.js",
    },
    plugins: [
      new WebpackMetadataSubscriberPlugin(
        metadata => (actualMetadata = metadata),
      ),
    ],
    module: {
      rules: [
        {
          test: /\.js/,
          loader: babelLoader,
          options: {
            metadataSubscribers: [WebpackMetadataSubscriberPlugin.subscriber],
            plugins: [babelMetadataProvierPlugin],
            babelrc: false,
            configFile: false,
          },
          exclude: /node_modules/,
        },
      ],
    },
  };

  const stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);

  assert.deepEqual(actualMetadata, { hello: "world" });
});

test("should obtain metadata from the transform result with cache", async () => {
  let actualMetadata;

  const config = {
    mode: "development",
    entry: "./test/fixtures/basic.js",
    output: {
      path: context.directory,
      filename: "[id].metadata.js",
    },
    plugins: [
      new WebpackMetadataSubscriberPlugin(
        metadata => (actualMetadata = metadata),
      ),
    ],
    module: {
      rules: [
        {
          test: /\.js/,
          loader: babelLoader,
          options: {
            cacheDirectory: true,
            metadataSubscribers: [WebpackMetadataSubscriberPlugin.subscriber],
            plugins: [babelMetadataProvierPlugin],
            babelrc: false,
            configFile: false,
          },
          exclude: /node_modules/,
        },
      ],
    },
  };

  const stats = await webpackAsync(config);
  assert.deepEqual(stats.compilation.errors, []);
  assert.deepEqual(stats.compilation.warnings, []);

  assert.deepEqual(actualMetadata, { hello: "world" });
});
