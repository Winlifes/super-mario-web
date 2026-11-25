import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeAssetBase, assetCsp } from "../shared/asset-config.mjs";
import { createGameServer } from "../server/index.mjs";
const base =
  "https://mac-cat.oss-cn-beijing.aliyuncs.com/mario/20261124-oss-v1/";

test("asset configuration rejects credential-bearing and non-HTTPS endpoints; CSP allows only the configured origin", () => {
  assert.equal(normalizeAssetBase(base.slice(0, -1)), base);
  for (const value of [
    "http://assets.example/a/",
    "https://user:secret@assets.example/a/",
    "https://assets.example/a/?token=secret",
    "https://assets.example/a/#fragment",
  ])
    assert.throws(() => normalizeAssetBase(value));
  const csp = assetCsp(base);
  assert.ok(
    csp.includes(
      "connect-src 'self' https://mac-cat.oss-cn-beijing.aliyuncs.com",
    ),
  );
  assert.ok(!csp.includes("*"));
  assert.ok(!assetCsp().includes("aliyuncs.com"));
});

test("OSS build rewrites document assets and retains a complete local upload tree and checksums", () => {
  const output = mkdtempSync(path.join(tmpdir(), "mario-oss-build-"));
  try {
    const result = spawnSync(process.execPath, ["scripts/build-static.mjs"], {
      encoding: "utf8",
      env: { ...process.env, ASSET_BASE_URL: base, BUILD_OUTPUT_DIR: output },
    });
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(path.join(output, "index.html"), "utf8");
    assert.ok(html.includes(`name="asset-base-url" content="${base}"`));
    assert.ok(html.includes(`${base}vendor/phaser-3.55.2.min.js?v=`));
    assert.ok(html.includes(`${base}javascript/assets.js?v=`));
    assert.ok(
      readFileSync(
        path.join(output, "assets/css/multiplayer.css"),
        "utf8",
      ).includes(
        `${base}assets/scenery/overworld/floorbricks.png?mario-use=css`,
      ),
    );
    assert.ok(!/(?:src|href)="(?:\.\/)?(?:vendor|javascript)\//.test(html));
    assert.ok(html.includes('href="assets/css/multiplayer.css?v='));
    const manifest = JSON.parse(
      readFileSync(path.join(output, "asset-manifest.json"), "utf8"),
    );
    assert.equal(manifest.baseURL, base);
    assert.ok(
      manifest.files.some((f) => f.path === "assets/first-world/castle.mp3"),
    );
    assert.ok(
      manifest.files.every(
        (f) => f.sha256.length === 64 && existsSync(path.join(output, f.path)),
      ),
    );
    assert.ok(
      !manifest.files.some((f) =>
        /server\/|node_modules\/|\.openai\//.test(f.path),
      ),
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("the HTTP service exposes the configured OSS origin without redirecting lobby APIs", async (t) => {
  const app = createGameServer({ assetBaseURL: base });
  const address = await app.listen(0);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).assetBaseURL, base);
  assert.ok(
    response.headers
      .get("content-security-policy")
      .includes(
        "script-src 'self' https://mac-cat.oss-cn-beijing.aliyuncs.com",
      ),
  );
  const lobby = await fetch(`http://127.0.0.1:${address.port}/api/lobby`);
  assert.equal(lobby.status, 200);
  assert.deepEqual((await lobby.json()).rooms, []);
});

test("a script-only OSS release keeps media on the existing prefix and serves scripts from the new prefix", () => {
  const output = mkdtempSync(path.join(tmpdir(), "mario-oss-scripts-"));
  const scriptBaseURL = new URL("../scripts-v1/", base).href;
  try {
    const result = spawnSync(process.execPath, ["scripts/build-static.mjs"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ASSET_BASE_URL: base,
        ASSET_SCRIPT_BASE_URL: scriptBaseURL,
        BUILD_OUTPUT_DIR: output,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(path.join(output, "index.html"), "utf8");
    const runtimeTag = html.match(
      /<script[^>]+\/javascript\/runtime\.js[^>]+>/,
    )?.[0];
    assert.ok(runtimeTag?.includes(`${scriptBaseURL}javascript/runtime.js?v=`));
    assert.ok(runtimeTag.includes('crossorigin="anonymous"'));
    assert.ok(html.includes(`${base}assets/favicon.png`));
    const manifest = JSON.parse(
      readFileSync(path.join(output, "asset-manifest.json"), "utf8"),
    );
    assert.equal(manifest.baseURL, base);
    assert.equal(manifest.scriptBaseURL, scriptBaseURL);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
