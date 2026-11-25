import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { normalizeAssetBase } from "../shared/asset-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(
  process.env.BUILD_OUTPUT_DIR || path.join(root, "dist"),
);
const baseURL = normalizeAssetBase(process.env.ASSET_BASE_URL || "");
if (output === root || root.startsWith(output + path.sep))
  throw new Error("Build output cannot replace the source directory.");
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  });
const digest = (filename) =>
  createHash("sha256").update(readFileSync(filename)).digest("hex");
const escapeAttribute = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

for (const filename of walk(path.join(root, "javascript")).filter((filename) =>
  filename.endsWith(".js"),
)) {
  const result = spawnSync(process.execPath, ["--check", filename], {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(result.stderr || `Invalid JavaScript: ${filename}`);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const entry of [
  "index.html",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "assets",
  "javascript",
  "vendor",
]) {
  cpSync(path.join(root, entry), path.join(output, entry), {
    recursive: true,
    filter: (filename) =>
      !path.relative(root, filename).split(path.sep).includes("showcase"),
  });
}

await build({
  entryPoints: [path.join(root, "javascript/runtime.mjs")],
  outfile: path.join(output, "javascript/runtime.js"),
  bundle: true,
  format: "iife",
  globalName: "MarioRuntime",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
});
rmSync(path.join(output, "javascript/runtime.mjs"));

const indexFile = path.join(output, "index.html");
const sourceHtml = readFileSync(indexFile, "utf8");
for (const match of sourceHtml.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (/^https?:/.test(match[1]))
    throw new Error(`Unexpected external page dependency: ${match[1]}`);
  if (!existsSync(path.join(output, match[1].split("?")[0])))
    throw new Error(`Missing page asset: ${match[1]}`);
}
for (const cssFile of walk(path.join(output, "assets/css")).filter((file) =>
  file.endsWith(".css"),
)) {
  for (const match of readFileSync(cssFile, "utf8").matchAll(
    /url\(['"]?([^)'"\s]+)['"]?\)/g,
  )) {
    if (/^https?:/.test(match[1]))
      throw new Error(`Unexpected external stylesheet dependency: ${match[1]}`);
    if (!existsSync(path.resolve(path.dirname(cssFile), match[1])))
      throw new Error(`Missing stylesheet asset: ${match[1]}`);
  }
  if (baseURL) {
    // CSS background images are fetched without CORS. Keep their cache keys
    // separate from Phaser's CORS XHR requests for the same texture.
    const cssBase = new URL(
      path.relative(output, path.dirname(cssFile)).split(path.sep).join("/") +
        "/",
      baseURL,
    );
    const css = readFileSync(cssFile, "utf8").replace(
      /url\(['"]?([^)'"\s]+)['"]?\)/g,
      (_, value) =>
        `url("${new URL(value, cssBase).href}${value.includes("?") ? "&" : "?"}mario-use=css")`,
    );
    writeFileSync(cssFile, css);
  }
}

let html = sourceHtml.replace(
  '<meta name="asset-base-url" content="" />',
  `<meta name="asset-base-url" content="${escapeAttribute(baseURL)}" />`,
);
html = html.replace(/(src|href)="([^"#]+)"/g, (_, attribute, value) => {
  const filename = value.replace(/^\.\//, "");
  if (!/^(?:assets|javascript|vendor)\//.test(filename))
    return `${attribute}="${value}"`;
  const isStylesheet =
    filename.startsWith("assets/css/") && filename.endsWith(".css");
  const url =
    baseURL && !isStylesheet ? new URL(filename, baseURL).href : value;
  const version = /\.(?:js|css)$/.test(filename)
    ? `?v=${digest(path.join(output, filename)).slice(0, 12)}`
    : "";
  return `${attribute}="${escapeAttribute(url + version)}"`;
});
if (baseURL) {
  html = html.replace(/<(?:script|link|img)\b[^>]*>/g, (tag) =>
    tag.includes(baseURL) && !tag.includes("crossorigin=")
      ? tag.replace(/\s*\/?>$/, (ending) => ` crossorigin="anonymous"${ending}`)
      : tag,
  );
  html = html.replace(
    "</head>",
    `  <link rel="preconnect" href="${new URL(baseURL).origin}" crossorigin="anonymous" />\n  </head>`,
  );
}
writeFileSync(indexFile, html);
const resources = walk(output)
  .filter((filename) => filename !== indexFile)
  .sort()
  .map((filename) => ({
    path: path.relative(output, filename).split(path.sep).join("/"),
    delivery:
      baseURL && !filename.startsWith(path.join(output, "assets/css/"))
        ? "oss"
        : "origin",
    bytes: statSync(filename).size,
    sha256: digest(filename),
  }));
writeFileSync(
  path.join(output, "asset-manifest.json"),
  JSON.stringify({ version: 1, baseURL, files: resources }, null, 2) + "\n",
);
const files = walk(output);
const bytes = files.reduce(
  (total, filename) => total + statSync(filename).size,
  0,
);
console.log(
  `Static build verified: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB. Asset base: ${baseURL || "same-origin"}.`,
);
