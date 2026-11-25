import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const manifest = JSON.parse(
  readFileSync(process.argv[2] || "dist/asset-manifest.json", "utf8"),
);
if (!manifest.baseURL)
  throw new Error("Build with ASSET_BASE_URL before checking OSS assets.");
const origin = process.env.VERIFY_ORIGIN || "https://game.winlife.fun";
const queue = manifest.files.filter((file) => file.delivery !== "origin"),
  verified = [],
  failures = [];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const item = queue.shift(),
        url = new URL(item.path, manifest.baseURL);
      try {
        const response = await fetch(url, {
          headers: { Origin: origin },
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer()),
          hash = createHash("sha256").update(bytes).digest("hex");
        if (bytes.length !== item.bytes || hash !== item.sha256)
          throw new Error("Size or SHA-256 mismatch");
        const cors = response.headers.get("access-control-allow-origin");
        if (cors !== "*" && cors !== origin)
          throw new Error("Missing cross-origin permission");
        const type = response.headers.get("content-type") || "";
        if (item.path.endsWith(".js") && !/javascript/.test(type))
          throw new Error(`Invalid script MIME: ${type}`);
        if (item.path.endsWith(".css") && !/text\/css/.test(type))
          throw new Error(`Invalid stylesheet MIME: ${type}`);
        verified.push({
          ...item,
          contentType: type,
          etag: response.headers.get("etag"),
          cacheControl: response.headers.get("cache-control"),
          cors,
          server: response.headers.get("server"),
        });
      } catch (error) {
        failures.push({ path: item.path, error: error.message });
      }
    }
  }),
);
const audio = await fetch(
  new URL("assets/first-world/castle.mp3", manifest.baseURL),
  {
    headers: { Origin: origin, Range: "bytes=0-1023" },
    signal: AbortSignal.timeout(30000),
  },
);
const range =
  audio.status === 206 && (await audio.arrayBuffer()).byteLength === 1024;
const report = {
  baseURL: manifest.baseURL,
  origin,
  files: verified.length,
  bytes: verified.reduce((n, f) => n + f.bytes, 0),
  range,
  failures,
  verified: verified.sort((a, b) => a.path.localeCompare(b.path)),
};
if (process.argv[3])
  writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, verified: undefined }));
if (failures.length || !range) process.exitCode = 1;
