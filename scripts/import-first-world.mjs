// Reproducible import of source map commands and lossless palette/RLE sprites.
// This imports data only; FullScreenMario's browser engine is not bundled.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const revision = "dc7db1fdea151684d78425bd1152ff680c7047d6";
const base = `https://raw.githubusercontent.com/JFOC/FullScreenMario/${revision}/`;
const local = process.argv[2];
async function source(path) {
  if (local) return readFileSync(`${local}/${path}`, "utf8");
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`Source download failed: ${path}`);
  return response.text();
}
const context = {
  FullScreenMario: { FullScreenMario: { settings: { maps: { library: {} } } } },
};
const evidence = [];
for (const path of [
  "Source/settings/maps/1-1.js",
  "Source/settings/maps/1-2.js",
  "Source/settings/maps/1-3.js",
  "Source/settings/maps/1-4.js",
  "Source/settings/sprites.js",
]) {
  const text = await source(path);
  evidence.push({
    path,
    sha256: createHash("sha256").update(text).digest("hex"),
  });
  runInNewContext(text, context, { timeout: 1000 });
}
mkdirSync("data", { recursive: true });
mkdirSync("assets/first-world", { recursive: true });
mkdirSync("vendor/fullscreenmario", { recursive: true });
writeFileSync(
  "data/first-world.json",
  JSON.stringify(
    context.FullScreenMario.FullScreenMario.settings.maps.library,
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "data/first-world-source.json",
  JSON.stringify(
    { repository: "JFOC/FullScreenMario", revision, evidence },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "vendor/fullscreenmario/LICENSE.txt",
  await source("LICENSE.txt"),
);

const { library, paletteDefault } =
  context.FullScreenMario.FullScreenMario.settings.sprites;
function decode(encoded) {
  let palette = paletteDefault.map((_, i) => i),
    digits = 2,
    i = 0;
  const pixels = [];
  while (i < encoded.length) {
    if (encoded[i] === "p") {
      const end = encoded.indexOf("]", i);
      if (encoded[i + 1] !== "[" || end < 0)
        throw new Error("Unsupported palette command");
      palette = encoded
        .slice(i + 2, end)
        .split(",")
        .map(Number);
      digits = String(palette.length - 1).length;
      i = end + 1;
    } else if (encoded[i] === "x") {
      i++;
      const color = palette[Number(encoded.slice(i, (i += digits)))];
      const end = encoded.indexOf(",", i),
        count = Number(encoded.slice(i, end));
      pixels.push(...Array(count).fill(color));
      i = end + 1;
    } else pixels.push(palette[Number(encoded.slice(i, (i += digits)))]);
  }
  return pixels;
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const b of buffer) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
function sprite(name, width, sources, paletteMap = {}) {
  const frames = sources.map((s) =>
      decode(s).map((color) => paletteMap[color] ?? color),
    ),
    height = frames[0].length / width;
  if (
    !Number.isInteger(height) ||
    frames.some((f) => f.length !== width * height)
  )
    throw new Error(`Invalid sprite dimensions: ${name}`);
  const totalWidth = width * frames.length,
    rows = [];
  for (let y = 0; y < height; y++) {
    const row = [0];
    for (const f of frames)
      for (let x = 0; x < width; x++)
        row.push(...paletteDefault[f[y * width + x]]);
    rows.push(Buffer.from(row));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(totalWidth);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    `assets/first-world/${name}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.concat(rows))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  return { name, width, height, frames: frames.length };
}
const C = library.Character,
  S = library.Solid,
  D = library.Scenery;
const sprites = [
  sprite("bowser", 32, [
    C.Bowser.normal.normal,
    C.Bowser.normal.two,
    C.Bowser.firing.normal,
    C.Bowser.firing.two,
  ]),
  sprite("bowser-fire", 24, [C.BowserFire]),
  sprite("piranha", 16, [C.Piranha.normal.normal, C.Piranha.normal.two]),
  sprite("star", 16, [C.Star.normal, C.Star.two, C.Star.three, C.Star.four]),
  sprite("axe", 16, [S.CastleAxe.normal, S.CastleAxe.two, S.CastleAxe.three]),
  sprite("castle-block", 16, [S.CastleBlock]),
  sprite("bridge", 16, [S.CastleBridge]),
  sprite("platform", 8, [S.Platform.normal]),
  sprite("tree-left", 16, [S.TreeTop.normal[2].left]),
  sprite("tree-middle", 16, [S.TreeTop.normal[2].middle]),
  sprite("tree-right", 16, [S.TreeTop.normal[2].right]),
  sprite("tree-trunk", 8, [D.TreeTrunk.normal]),
  sprite("lava", 8, [D.Water.Castle.normal[2].top]),
  sprite("toad", 16, [D.Toad]),
  sprite("stone-castle", 16, [S.Stone.Castle.normal]),
  sprite("floor-castle", 16, [S.Stone.Castle.normal]),
  sprite("koopa-winged", 16, [
    C.Koopa.normal.normal.jumping.normal,
    C.Koopa.normal.normal.jumping.two,
  ]),
  sprite(
    "koopa-red",
    16,
    [C.Koopa.normal.normal.normal.normal, C.Koopa.normal.normal.normal.two],
    { 14: 8 },
  ),
  sprite(
    "koopa-winged-red",
    16,
    [C.Koopa.normal.normal.jumping.normal, C.Koopa.normal.normal.jumping.two],
    { 14: 8 },
  ),
  sprite("shell-red", 16, [C.Shell.normal.normal.normal], { 14: 8 }),
];
writeFileSync(
  "data/first-world-sprites.json",
  JSON.stringify(sprites, null, 2) + "\n",
);
console.log(
  `Imported four maps and ${sprites.length} original pixel sprite sheets from ${revision}.`,
);

for (const [name, path] of Object.entries({
  castle: "Source/Sounds/Themes/mp3/Castle.mp3",
  star: "Source/Sounds/Themes/mp3/Star.mp3",
  oneup: "Source/Sounds/Sounds/mp3/Gain Life.mp3",
  bridge: "Source/Sounds/Sounds/mp3/Bowser Falls.mp3",
})) {
  const bytes =
    local && existsSync(`${local}/${path}`)
      ? readFileSync(`${local}/${path}`)
      : Buffer.from(await (await fetch(base + encodeURI(path))).arrayBuffer());
  writeFileSync(`assets/first-world/${name}.mp3`, bytes);
}
