import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const manifest = JSON.parse(readFileSync("dist/asset-manifest.json", "utf8"));
if (!manifest.baseURL) throw new Error("Build with ASSET_BASE_URL first.");
const version = new URL(manifest.baseURL).pathname
  .split("/")
  .filter(Boolean)
  .at(-1);
const directory = path.resolve(
  process.argv[2] || `.openai/oss-upload/${version}`,
);
if (existsSync(directory) && readdirSync(directory).length)
  throw new Error("Use a new, empty upload directory for each asset version.");
let count = 0,
  bytes = 0;
for (const file of manifest.files.filter((file) => file.delivery === "oss")) {
  if (
    !/^(?:assets\/|javascript\/|vendor\/|LICENSE$|THIRD_PARTY_NOTICES\.md$)/.test(
      file.path,
    ) ||
    file.path.split("/").includes("..")
  )
    throw new Error("Invalid public asset path.");
  const source = path.join("dist", file.path),
    content = readFileSync(source);
  if (createHash("sha256").update(content).digest("hex") !== file.sha256)
    throw new Error(`Asset changed after build: ${file.path}`);
  const target = path.join(directory, file.path);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  count++;
  bytes += content.length;
}
console.log(
  JSON.stringify({ directory, files: count, bytes, baseURL: manifest.baseURL }),
);
