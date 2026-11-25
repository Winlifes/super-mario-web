import { readFileSync } from "node:fs";
import { makeLevel as meadow } from "./meadow.mjs";
const maps = JSON.parse(
  readFileSync(new URL("../data/campaign.json", import.meta.url)),
);
const corrections = JSON.parse(
  readFileSync(new URL("../data/campaign-corrections.json", import.meta.url)),
);
for (const correction of corrections) {
  const command = maps[correction.stage].areas[correction.area].creation.find(
    (c) => c.thing === correction.thing && c.x === correction.x,
  );
  if (
    !command ||
    Object.keys(correction.set).some((k) => command[k] !== undefined)
  )
    throw new Error("Source correction no longer applies");
  Object.assign(command, correction.set);
}
const patterns = JSON.parse(
  readFileSync(new URL("../data/campaign-patterns.json", import.meta.url)),
);
export const stages = Object.freeze(
  Array.from({ length: 8 }, (_, w) =>
    Array.from({ length: 4 }, (_, s) => `${w + 1}-${s + 1}`),
  ).flat(),
);
const spriteSizes = Object.fromEntries(
  JSON.parse(
    readFileSync(new URL("../data/campaign-sprites.json", import.meta.url)),
  ).map((s) => [s.name, s]),
);
const FLOOR = 208,
  SECTION_WIDTH = 160;
const scenery = new Set([
  "PlantLarge",
  "PlantSmall",
  "Fence",
  "CastleWall",
  "Cloud1",
  "Cloud2",
  "Cloud3",
  "Bush1",
  "Bush2",
  "Bush3",
  "HillLarge",
  "HillSmall",
]);
const enemyNames = {
  Goomba: "goomba",
  Koopa: "koopa",
  Beetle: "beetle",
  Blooper: "blooper",
  CheepCheep: "cheep",
  Podoboo: "podoboo",
  HammerBro: "hammerbro",
  Lakitu: "lakitu",
};
const infinity = (value) => value === "Infinity" || value === Infinity;

// Source coordinates: eight map units are one 16 px tile; y is measured upward from the floor.
export function makeLevel(seed = 1, stage = "1-1") {
  if (stage === "meadow") {
    const l = meadow(seed);
    Object.assign(l, {
      stage,
      startZone: 0,
      spawn: { x: 40, y: 192 },
      movers: [],
      hazards: [],
      decorations: [],
      portals: [],
      triggers: [],
      springs: [],
      sections: [],
    });
    l.zones = [{ ...l, zone: 0 }];
    delete l.zones[0].zones;
    return l;
  }
  if (!maps[stage]) stage = "1-1";
  const map = maps[stage];
  let serial = 0;
  const zones = map.areas.map((area, zone) => {
    const underwater = !!area.underwater;
    const l = {
      id: `${stage}:${zone}`,
      stage,
      zone,
      title: `${stage} · ${underwater ? "水下" : area.setting.includes("Underworld") ? "地下" : area.setting.includes("Castle") ? "城堡" : area.setting.includes("Sky") ? "天空" : area.setting.includes("Night") ? "夜晚" : "地上"}`,
      setting: area.setting,
      underwater,
      sky: area.setting.includes("Sky"),
      exit: area.exit,
      width: 320,
      height: 240,
      platforms: [],
      coins: [],
      enemies: [],
      movers: [],
      hazards: [],
      decorations: [],
      portals: [],
      triggers: [],
      springs: [],
      sections: [],
      checkpoints: [],
      spawn: { x: 40, y: 192 },
      goal: null,
    };
    const id = (p) => `${stage}:${zone}:${p}${serial++}`;
    function solid(type, x, y, w = 16, h = 16, extra = {}) {
      const t = { id: id("t"), type, x, y, w, h, zone, ...extra };
      l.platforms.push(t);
      l.width = Math.max(l.width, x + w);
      return t;
    }
    const trigger = (type, x, y, w, h, extra = {}) =>
      l.triggers.push({ id: id("d"), type, x, y, w, h, zone, ...extra });
    // Sections retain their branch graph. A failed corridor repeats rather than silently opening the boss exit.
    const firstSection = area.creation.find((c) => c.macro === "Section");
    let cursor = firstSection?.x || 0;
    for (const [index, section] of (area.sections || []).entries()) {
      const branch = section.after?.creation.find((c) =>
        ["Section", "SectionDecider"].includes(c.macro),
      );
      const width =
        (section.before?.width || 0) +
        (section.stretch ? SECTION_WIDTH : 0) +
        (branch ? branch.x || 0 : section.after?.width || 0);
      l.sections.push({ index, x: cursor * 2, width: width * 2 });
      cursor += width;
    }
    function add(c, section = null) {
      const x = (c.x || 0) * 2,
        y = FLOOR - (c.y || 0) * 2;
      const w = (c.width ?? 8) * 2,
        h = infinity(c.height) ? 240 - y : (c.height ?? 8) * 2;
      if (c.macro === "Fill") {
        for (let i = 0; i < (c.xnum || 1); i++)
          for (let j = 0; j < (c.ynum || 1); j++)
            add(
              {
                ...c,
                macro: undefined,
                x: (c.x || 0) + i * (c.xwidth || 8),
                y: (c.y || 0) + j * (c.yheight || 8),
              },
              section,
            );
      } else if (c.macro === "Pattern") {
        const pattern = patterns[c.pattern];
        if (!pattern) throw new Error(`Unknown pattern ${c.pattern}`);
        for (let i = 0; i < (c.repeat || 1); i++)
          for (const [thing, dx, dy, width] of pattern.things)
            add(
              {
                thing,
                x: (c.x || 0) + dx + i * pattern.width,
                y: (c.y || 0) + dy + (spriteSizes[thing]?.height || 16) / 2,
                ...(width ? { width } : {}),
              },
              section,
            );
      } else if (c.macro === "Floor") solid("ground", x, y, w, 240 - y);
      else if (c.macro === "Ceiling")
        add(
          {
            macro: "Fill",
            thing: "Brick",
            x: c.x,
            y: 88,
            xnum: Math.floor(c.width / 8),
          },
          section,
        );
      else if (c.macro === "Pipe") {
        const height = infinity(c.height) ? "Infinity" : c.height || 16;
        add(
          {
            ...c,
            macro: undefined,
            thing: "PipeVertical",
            y: (c.y || 0) + (infinity(height) ? 0 : height),
            height,
            width: 16,
          },
          section,
        );
      } else if (["Tree", "Shroom"].includes(c.macro)) {
        const width = (c.width || 24) * 2,
          shroom = c.macro === "Shroom";
        solid(shroom ? "shroom" : "tree", x, y, width, 16);
        if (width > 32) {
          const trunk = {
            type: shroom ? "shroom-trunk" : "trunk",
            x: shroom ? x + (width - 16) / 2 : x + 16,
            y: y + 16,
            w: shroom ? 16 : width - 32,
            h: 240 - y,
          };
          l.decorations.push(trunk);
          if (c.solidTrunk)
            solid(trunk.type, trunk.x, trunk.y, trunk.w, trunk.h);
        }
      } else if (c.macro === "Bridge") {
        let left = x,
          width = Math.max(w, 32);
        if (c.begin) {
          solid("stone", left, y, 16, 240 - y);
          left += 16;
          width -= 16;
        }
        if (c.end) {
          width -= 16;
          solid("stone", left + width, y, 16, 240 - y);
        }
        solid("bridge-base", left, y, width, 8);
        l.decorations.push({
          type: "railing",
          x: left,
          y: y - 8,
          w: width,
          h: 8,
        });
      } else if (c.macro === "Scale") {
        const group = id("scale"),
          between = (c.between || 40) * 2;
        for (const [side, dx, drop, width] of [
          [0, 0, c.dropLeft || 24, c.widthLeft || 24],
          [1, between, c.dropRight || 24, c.widthRight || 24],
        ]) {
          l.movers.push({
            id: id("m"),
            zone,
            type: "platform",
            x: x + dx - width,
            y: y + drop * 2,
            w: width * 2,
            h: 8,
            mode: "scale",
            group,
            side,
            anchorX: x + dx,
            anchorY: y,
            tension: (drop - 1.5) * 2,
            speed: 0,
          });
        }
        l.decorations.push({
          type: "scale-string",
          x,
          y,
          w: between,
          h: 2,
          group,
        });
      } else if (c.macro === "PlatformGenerator") {
        for (const sy of c.direction === -1 ? [8, 56] : [0, 48])
          l.movers.push({
            id: id("m"),
            zone,
            type: "platform",
            x,
            y: FLOOR - sy * 2,
            w: (c.width || 16) * 2,
            h: 8,
            mode: "loop",
            speed: (c.direction || 1) * 50.4,
          });
      } else if (c.macro === "Water") {
        l.hazards.push({
          id: id("h"),
          type: area.setting.includes("Castle") ? "lava" : "water",
          x,
          y: y - 4,
          w,
          h: 244 - y,
          zone,
        });
      } else if (c.macro === "StartInsideCastle") {
        solid("stone", x, y - 96, 48, 240 - y + 96);
        solid("stone", x + 48, y - 80, 16, 240 - y + 80);
        solid("stone", x + 64, y - 64, 16, 240 - y + 64);
        if (c.width > 40)
          solid("ground", x + 80, y - 48, (c.width - 40) * 2, 240 - y + 48);
        l.spawn = { x: 16, y: FLOOR - 112 };
      } else if (c.macro === "EndOutsideCastle") {
        solid("stone", x, y - 16, 16, 16);
        const castleX = x + (c.castleDistance || (c.large ? 24 : 32)) * 2;
        const doorX = castleX + (c.large ? 64 : 40);
        l.goal = {
          type: "flag",
          x: x + 6,
          y: y - 168,
          groundY: y,
          poleBottom: y - 16,
          doorX,
          nextStage: c.transport?.map,
          castleX,
          large: !!c.large,
        };
        l.decorations.push({ type: "castle", x: doorX, y, large: !!c.large });
        l.width = Math.max(l.width, doorX + 160);
      } else if (c.macro === "EndInsideCastle") {
        solid("stone", x, y - 176, 512, 16);
        l.hazards.push({
          id: id("h"),
          type: "lava",
          x,
          y,
          w: 208,
          h: 32,
          zone,
        });
        for (let dx = 0; dx < 208; dx += 4)
          solid("bridge", x + dx, y - 48, 4, 8);
        l.enemies.push({
          id: id("e"),
          type: "bowser",
          x: x + 138,
          y: y - 84,
          vx: -16.8,
          zone,
          throwing: !!c.throwing,
          disguise: c.spawnType || "Goomba",
        });
        solid("ground", x + 208, y, 304, 32);
        solid("stone", x + 208, y - 64, 48, 64);
        solid("stone", x + 224, y - 160, 32, 48);
        l.axe = { x: x + 208, y: y - 80, w: 16, h: 16 };
        l.goal = {
          type: c.npc === "Peach" ? "peach" : "toad",
          x: x + 360,
          y: y - 26,
          groundY: y,
          nextStage: c.transport?.map,
        };
        l.decorations.push({ type: l.goal.type, x: x + 400, y: y - 26 });
        l.width = Math.max(l.width, x + 512);
      } else if (c.macro === "WarpWorld") {
        l.decorations.push({ type: "warp-welcome", x: x + 128, y: 64 });
        c.warps.forEach((world, i) => {
          const dx = 8 + i * 32 + (c.warps.length === 1 ? 32 : 0);
          add(
            {
              macro: "Pipe",
              x: (c.x || 0) + dx,
              height: 24,
              transport: { map: `${world}-1` },
            },
            section,
          );
          l.decorations.push({
            type: "warp",
            x: x + dx * 2 + 16,
            y: 134,
            world,
          });
        });
      } else if (["CastleSmall", "CastleLarge"].includes(c.macro))
        l.decorations.push({
          type: "castle",
          x: x + (c.macro === "CastleLarge" ? 64 : 40),
          y,
          large: c.macro === "CastleLarge",
        });
      else if (["SectionPass", "SectionFail"].includes(c.macro))
        trigger(
          c.macro === "SectionPass" ? "maze-pass" : "maze-fail",
          x,
          y,
          w,
          h,
          { section },
        );
      else if (c.macro === "SectionDecider")
        trigger("maze-decide", x, -32, 16, 320, {
          section,
          pass: c.pass || 0,
          fail: c.fail || 0,
        });
      else if (c.macro === "Section") {
        if (section !== null)
          trigger("maze-next", x, -32, 16, 320, {
            section,
            target: c.section || 0,
          });
      } else if (
        [
          "CheepsStart",
          "CheepsStop",
          "BulletBillsStart",
          "BulletBillsStop",
          "LakituStop",
        ].includes(c.macro)
      )
        trigger(c.macro, x, -32, 16, 320);
      else if (c.macro)
        throw new Error(`Unhandled macro ${stage}/${zone}: ${c.macro}`);
      else if (c.thing === "Brick" || c.thing === "Block") {
        const contents = Array.isArray(c.contents) ? c.contents[0] : c.contents;
        const content =
          {
            Mushroom: "power",
            Mushroom1Up: "oneup",
            Star: "star",
            Coin: "multi",
            Vine: "vine",
          }[contents] || (c.thing === "Block" ? "coin" : undefined);
        solid(c.thing === "Block" ? "question" : "brick", x, y, 16, 16, {
          ...(content ? { content } : {}),
          ...(contents === "Vine"
            ? { transport: c.contents[1].transport }
            : {}),
          ...(c.hidden ? { hidden: true } : {}),
        });
      } else if (c.thing === "Stone" || c.thing === "CastleBlock") {
        solid(
          c.thing === "CastleBlock" ? "castle-block" : "stone",
          x,
          y,
          w,
          h,
          { ...(c.hidden ? { hidden: true } : {}) },
        );
        if (c.fireballs)
          l.hazards.push({
            id: id("h"),
            type: "firebar",
            x: x + 8,
            y: y + 8,
            count: c.fireballs,
            speed: c.speed || c.direction || 1,
            zone,
          });
      } else if (["PipeVertical", "PipeHorizontal"].includes(c.thing)) {
        const t = solid(
          c.thing === "PipeHorizontal" ? "pipe-side" : "pipe",
          x,
          y,
          c.width ? w : 32,
          c.thing === "PipeHorizontal" ? 32 : h,
        );
        if (c.transport !== undefined)
          l.portals.push({
            id: t.id,
            x,
            y,
            w: t.w,
            h: t.h,
            target: c.transport,
            direction: c.thing === "PipeHorizontal" ? "right" : "down",
          });
        if (Number.isInteger(c.entrance))
          l.decorations.push({
            type: "entrance",
            location: c.entrance,
            x: x + 8,
            y: y - 16,
            pipeY: y,
          });
        if (c.piranha)
          l.enemies.push({
            id: id("e"),
            type: "piranha",
            x: x + 8,
            y: y - 24,
            pipeY: y,
            vx: 0,
            zone,
          });
      } else if (c.thing === "Coin") {
        l.coins.push({ id: id("c"), x: x + 6, y: y + 7, zone });
        l.width = Math.max(l.width, x + 16);
      } else if (enemyNames[c.thing])
        l.enemies.push({
          id: id("e"),
          type: enemyNames[c.thing],
          x,
          y,
          vx: -30,
          smart: !!c.smart,
          winged: !!c.jumping,
          floating: !!c.floating,
          begin: FLOOR - (c.end || 0) * 2,
          end: FLOOR - (c.begin || 0) * 2,
          red: !!c.red,
          zone,
        });
      else if (c.thing === "Platform") {
        const mode = c.falling
          ? "falling"
          : c.transport
            ? "transport"
            : c.floating
              ? "vertical"
              : c.sliding
                ? "horizontal"
                : "static";
        l.movers.push({
          id: id("m"),
          zone,
          type: "platform",
          x,
          y,
          w,
          h: 8,
          mode,
          begin: c.floating ? FLOOR - (c.end || 0) * 2 : (c.begin || 0) * 2,
          end: c.floating ? FLOOR - (c.begin || 0) * 2 : (c.end || 0) * 2,
          speed: c.speed ? c.speed * 60 : 45,
        });
        l.width = Math.max(l.width, x + w);
      } else if (c.thing === "Springboard") {
        const t = solid("spring", x, y, 16, 29);
        l.springs.push({ id: t.id, x, y, w: 16, h: 29, zone });
      } else if (c.thing === "Coral") solid("coral", x, y, 16, h);
      else if (c.thing === "Cannon") {
        const t = solid("cannon", x, y, w, h);
        if (!c.noBullets)
          trigger("cannon", x, y, w, h, {
            frequency: c.frequency || 280,
            tile: t.id,
          });
      } else if (scenery.has(c.thing))
        l.decorations.push({
          type: "source-scenery",
          sprite: c.thing,
          x,
          y,
          w: c.width ? w : null,
          h: c.height ? h : null,
        });
      else if (
        ![
          "ScrollEnabler",
          "ScrollBlocker",
          "DecorativeBack",
          "DecorativeDot",
          "CustomText",
        ].includes(c.thing)
      )
        throw new Error(`Unhandled thing ${stage}/${zone}: ${c.thing}`);
    }
    area.creation.forEach((c) => add(c));
    for (const [index, section] of (area.sections || []).entries()) {
      let offset = l.sections[index].x / 2;
      for (const part of ["before", "stretch", "after"]) {
        const data = section[part];
        if (!data) continue;
        for (const raw of data.creation) {
          const c = {
            ...raw,
            x: offset + (part === "stretch" ? 0 : raw.x || 0),
          };
          if (part === "stretch") c.width = SECTION_WIDTH;
          if (c.sliding) {
            c.begin += offset;
            c.end += offset;
          }
          add(c, index);
        }
        offset += part === "stretch" ? SECTION_WIDTH : data.width;
      }
    }
    if (l.goal?.type === "flag") {
      const last = l.platforms.filter((t) => t.type === "ground").at(-1);
      if (last && last.x + last.w < l.width) last.w = l.width - last.x;
    }
    // Original checkpoint remains halfway through the main course, on an actual floor tile.
    if (!l.sky && !area.setting.includes("Castle")) {
      const floor = l.platforms
        .filter(
          (t) =>
            t.type === "ground" &&
            t.w >= 96 &&
            t.x < l.width * 0.65 &&
            t.x + t.w > l.width * 0.45,
        )
        .sort(
          (a, b) => Math.abs(a.x - l.width / 2) - Math.abs(b.x - l.width / 2),
        )[0];
      if (floor)
        l.checkpoints.push({
          x: Math.max(
            floor.x + 16,
            Math.min(l.width / 2, floor.x + floor.w - 32),
          ),
          y: floor.y - 16,
        });
    }
    return l;
  });
  const locations = map.locations.map((loc, i) => {
    const zone = loc.area || 0,
      z = zones[zone],
      entrance = z.decorations.find(
        (d) => d.type === "entrance" && d.location === i,
      );
    return {
      zone,
      entry: loc.entry || "Normal",
      ...(entrance || z.spawn),
      ...(loc.xloc !== undefined ? { x: loc.xloc * 2 } : {}),
      ...(loc.entry === "Vine" ? { x: 32, y: 176 } : {}),
      ...(loc.entry === "Walking" ? { x: 24, y: 192 } : {}),
    };
  });
  for (const z of zones)
    if (z.sky) z.entryVine = { x: 32, y: 144, w: 14, h: 112 };
  return {
    ...zones[0],
    id: stage,
    stage,
    title: `${stage} · 世界 ${stage[0]}`,
    zones,
    locations,
    startZone: 0,
    time: map.time || 400,
    entry: locations[0].entry,
  };
}
export function publicLevel(l) {
  const view = (z) => ({
    ...z,
    platforms: z.platforms.map(({ content, transport, ...t }) => t),
  });
  return { ...view(l), zones: l.zones.map(view) };
}
