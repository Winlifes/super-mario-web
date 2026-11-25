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
  ...Array.from({ length: 8 }, (_, w) =>
    Array.from(
      { length: 4 },
      (_, s) => `Source/settings/maps/${w + 1}-${s + 1}.js`,
    ),
  ).flat(),
  "Source/settings/sprites.js",
]) {
  const text = await source(path);
  evidence.push({
    path,
    sha256: createHash("sha256").update(text).digest("hex"),
  });
  runInNewContext(text, context, { timeout: 1000 });
}
for (const path of [
  "Source/FullScreenMario.js",
  "Source/settings/objects.js",
  "Source/settings/scenes.js",
  "Source/settings/math.js",
  "Source/settings/maps.js",
]) {
  const text = await source(path);
  evidence.push({
    path,
    sha256: createHash("sha256").update(text).digest("hex"),
  });
}
mkdirSync("data", { recursive: true });
mkdirSync("assets/campaign", { recursive: true });
mkdirSync("vendor/fullscreenmario", { recursive: true });
writeFileSync(
  "data/campaign.json",
  JSON.stringify(
    context.FullScreenMario.FullScreenMario.settings.maps.library,
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "data/campaign-source.json",
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
    throw new Error(
      `Invalid sprite dimensions: ${name} ${width} ${frames.map((f) => f.length)}`,
    );
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
    `assets/campaign/${name}.png`,
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
  sprite("beetle", 16, [C.Beetle.normal.normal, C.Beetle.normal.two]),
  sprite("beetle-shell", 16, [C.BeetleShell.normal]),
  sprite("blooper", 16, [C.Blooper.normal.normal]),
  sprite("blooper-squeeze", 16, [C.Blooper.normal.squeeze]),
  sprite("cheep", 16, [C.CheepCheep.normal.normal, C.CheepCheep.normal.two]),
  sprite("cheep-red", 16, [C.CheepCheep.red.normal, C.CheepCheep.red.two]),
  sprite("podoboo", 14, [C.Podoboo]),
  sprite("bill", 16, [C.BulletBill.normal]),
  sprite("lakitu", 16, [C.Lakitu.normal]),
  sprite("lakitu-hiding", 16, [C.Lakitu.hiding]),
  sprite("spiny", 16, [C.Spiny.normal, C.Spiny.two]),
  sprite("spiny-egg", 14, [C.SpinyEgg.normal, C.SpinyEgg.two]),
  sprite("hammerbro", 16, [
    C.HammerBro.normal.normal,
    C.HammerBro.normal.two,
    C.HammerBro.throwing.normal,
    C.HammerBro.throwing.two,
  ]),
  sprite("hammer", 16, [
    C.Hammer.normal.normal,
    C.Hammer.normal.two,
    C.Hammer.normal.three,
    C.Hammer.normal.four,
  ]),
  sprite("firework", 16, [S.Firework.normal, S.Firework.n2, S.Firework.n3]),
  sprite("peach", 16, [D.Peach]),
  sprite("castle-flag", 13, [D.CastleFlag]),
  sprite("coral", 16, [S.Coral]),
  sprite("cannon-top", 16, [S.Cannon[2].top]),
  sprite("cannon-body", 16, [S.Cannon[2].middle]),
  sprite("vine-top", 14, [C.Vine[2].top]),
  sprite("vine-body", 14, [C.Vine[2].middle]),
  sprite("spring-body", 16, [S.Springboard.normal[2].middle]),
  sprite("spring-bottom", 16, [S.Springboard.normal[2].bottom]),
  sprite("shroom-left", 16, [S.ShroomTop[2].left]),
  sprite("shroom-middle", 16, [S.ShroomTop[2].middle]),
  sprite("shroom-right", 16, [S.ShroomTop[2].right]),
  sprite("shroom-trunk", 16, [D.ShroomTrunk[2].middle]),
  sprite("bridge-base", 16, [D.BridgeBase]),
  sprite("railing", 8, [D.Railing.normal]),
  sprite("bubble", 4, [C.Bubble]),
  sprite("castle-wall", 16, [D.CastleWall.normal]),
  ...[
    "Cloud1",
    "Cloud2",
    "Cloud3",
    "Bush1",
    "Bush2",
    "Bush3",
    "HillLarge",
    "HillSmall",
    "PlantSmall",
    "PlantLarge",
    "Fence",
  ].map((name) =>
    sprite(
      name,
      {
        Cloud1: 32,
        Cloud2: 48,
        Cloud3: 64,
        Bush1: 32,
        Bush2: 48,
        Bush3: 64,
        HillLarge: 80,
        HillSmall: 48,
        PlantSmall: 14,
        PlantLarge: 16,
        Fence: 16,
      }[name],
      [typeof D[name] === "string" ? D[name] : D[name].normal],
    ),
  ),
  sprite("player-dead", 15, [C.Player.dead]),
  ...["normal", "large", "fiery"].flatMap((form, i) => {
    const p = C.Player.normal[form].normal;
    return [
      sprite(`player-skid-${i}`, 16, [p.running.skidding]),
      sprite(`player-climb-${i}`, 16, [p.climbing.normal, p.climbing.two]),
      sprite(`player-swim-${i}`, 16, [
        p.paddling.normal.paddle1,
        p.paddling.normal.paddle2,
        p.paddling.normal.paddle3,
      ]),
    ];
  }),
];
writeFileSync(
  "data/campaign-sprites.json",
  JSON.stringify(sprites, null, 2) + "\n",
);
console.log(
  `Imported all 32 maps and ${sprites.length} original pixel sprite sheets from ${revision}.`,
);

for (const [name, path] of Object.entries({
  castle: "Source/Sounds/Themes/mp3/Castle.mp3",
  star: "Source/Sounds/Themes/mp3/Star.mp3",
  oneup: "Source/Sounds/Sounds/mp3/Gain Life.mp3",
  bridge: "Source/Sounds/Sounds/mp3/Bowser Falls.mp3",
  underwater: "Source/Sounds/Themes/mp3/Underwater.mp3",
  sky: "Source/Sounds/Themes/mp3/Sky.mp3",
  flagpole: "Source/Sounds/Sounds/mp3/Flagpole.mp3",
  stageclear: "Source/Sounds/Sounds/mp3/Stage Clear.mp3",
  worldclear: "Source/Sounds/Sounds/mp3/World Clear.mp3",
  firework: "Source/Sounds/Sounds/mp3/Firework.mp3",
  ending: "Source/Sounds/Sounds/mp3/Ending.mp3",
  pipe: "Source/Sounds/Sounds/mp3/Pipe.mp3",
  vine: "Source/Sounds/Sounds/mp3/Vine Emerging.mp3",
  die: "Source/Sounds/Sounds/mp3/Player Dies.mp3",
})) {
  let bytes;
  if (local && existsSync(`${local}/${path}`))
    bytes = readFileSync(`${local}/${path}`);
  else {
    const response = await fetch(base + encodeURI(path));
    if (!response.ok)
      throw new Error(`Audio download failed: ${path} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (local) {
      mkdirSync(`${local}/${path.slice(0, path.lastIndexOf("/"))}`, {
        recursive: true,
      });
      writeFileSync(`${local}/${path}`, bytes);
    }
  }
  evidence.push({
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  writeFileSync(`assets/campaign/${name}.mp3`, bytes);
}

// Map patterns carry a non-JSON array width property in the original settings.
const settingsContext = {
  FullScreenMario: { FullScreenMario: { settings: {}, prototype: {} } },
};
runInNewContext(await source("Source/settings/maps.js"), settingsContext, {
  timeout: 1000,
});
writeFileSync(
  "data/campaign-patterns.json",
  JSON.stringify(
    Object.fromEntries(
      Object.entries(
        settingsContext.FullScreenMario.FullScreenMario.settings.maps.patterns,
      ).map(([k, v]) => [k, { width: v.width, things: v }]),
    ),
    null,
    2,
  ) + "\n",
);

writeFileSync(
  "data/campaign-source.json",
  JSON.stringify(
    { repository: "JFOC/FullScreenMario", revision, evidence },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  "javascript/campaign-assets.js",
  `window.MarioCampaignAssets = Object.freeze(${JSON.stringify(sprites)});\n`,
);
