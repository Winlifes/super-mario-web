import { readFileSync } from "node:fs";
import { makeLevel as meadow } from "./meadow.mjs";
const maps = JSON.parse(
  readFileSync(new URL("../data/first-world.json", import.meta.url), "utf8"),
);
export const stages = Object.freeze(["1-1", "1-2", "1-3", "1-4"]);
const FLOOR = 208;
// Source coordinates: 8 FullScreenMario units = one 16 px NES tile; y is top, upward from floor.
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
    });
    l.zones = [{ ...l, zone: 0 }];
    delete l.zones[0].zones;
    return l;
  }
  if (!maps[stage]) stage = "1-1";
  const map = maps[stage];
  let serial = 0;
  const zones = map.areas.map((area, zone) => {
    const l = {
      id: `${stage}:${zone}`,
      stage,
      zone,
      title: `${stage} · ${area.setting === "Underworld" ? "地下" : area.setting === "Castle" ? "城堡" : stage === "1-3" ? "树台" : "草地"}`,
      setting: area.setting,
      width: 320,
      height: 240,
      platforms: [],
      coins: [],
      enemies: [],
      movers: [],
      hazards: [],
      decorations: [],
      portals: [],
      checkpoints: [40],
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
    function add(c) {
      const x = (c.x || 0) * 2,
        y = FLOOR - (c.y || 0) * 2,
        w = (c.width || 8) * 2,
        h = c.height === Infinity ? 240 - y : (c.height || 8) * 2;
      if (c.macro === "Fill") {
        for (let i = 0; i < (c.xnum || 1); i++)
          for (let j = 0; j < (c.ynum || 1); j++)
            add({
              ...c,
              macro: undefined,
              x: (c.x || 0) + i * (c.xwidth || 8),
              y: (c.y || 0) + j * (c.yheight || 8),
            });
      } else if (c.macro === "Floor")
        solid("ground", x, y, (c.width || 8) * 2, 240 - y);
      else if (c.macro === "Ceiling")
        add({
          macro: "Fill",
          thing: "Brick",
          x: c.x,
          y: 88,
          xnum: Math.floor(c.width / 8),
        });
      else if (c.macro === "Pipe")
        add({
          ...c,
          macro: undefined,
          thing: "PipeVertical",
          y: (c.y || 0) + (c.height || 16),
          height: c.height || 16,
          width: 16,
        });
      else if (c.macro === "Tree") {
        solid("tree", x, y, (c.width || 24) * 2, 16);
        if (c.width > 16) {
          l.decorations.push({
            type: "trunk",
            x: x + 16,
            y: y + 16,
            w: w - 32,
            h: 240 - y,
          });
          if (c.solidTrunk) solid("trunk", x + 16, y + 16, w - 32, 240 - y);
        }
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
      } else if (c.macro === "Water")
        l.hazards.push({
          id: id("h"),
          type: "lava",
          x,
          y,
          w,
          h: 240 - y,
          zone,
        });
      else if (c.macro === "StartInsideCastle") {
        solid("stone", x, FLOOR - 96, 48, 128);
        solid("stone", x + 48, FLOOR - 80, 16, 112);
        solid("stone", x + 64, FLOOR - 64, 16, 96);
        solid("ground", x + 80, FLOOR - 48, ((c.width || 104) - 40) * 2, 80);
        l.spawn = { x: 16, y: FLOOR - 112 };
      } else if (c.macro === "EndOutsideCastle") {
        solid("stone", x, FLOOR - 16, 16, 16);
        l.goal = { type: "flag", x: x + 6, y: 40, groundY: FLOOR };
        l.decorations.push({
          type: "castle",
          x: x + 104,
          y: FLOOR,
          large: !!c.large,
        });
        l.width = Math.max(l.width, x + 320);
      } else if (c.macro === "EndInsideCastle") {
        solid("stone", x, FLOOR - 176, 512, 16);
        l.hazards.push({
          id: id("h"),
          type: "lava",
          x,
          y: FLOOR,
          w: 208,
          h: 32,
          zone,
        });
        for (let dx = 0; dx < 208; dx += 16)
          solid("bridge", x + dx, FLOOR - 48, 16, 16);
        l.enemies.push({
          id: id("e"),
          type: "bowser",
          x: x + 138,
          y: FLOOR - 84,
          vx: -16.8,
          zone,
        });
        solid("ground", x + 208, FLOOR, 304, 32);
        solid("stone", x + 208, FLOOR - 64, 48, 64);
        solid("stone", x + 224, FLOOR - 160, 32, 48);
        l.axe = { x: x + 208, y: FLOOR - 80, w: 16, h: 16 };
        l.goal = { type: "toad", x: x + 360, y: FLOOR - 26, groundY: FLOOR };
        l.decorations.push({ type: "toad", x: x + 400, y: FLOOR - 26 });
        l.width = Math.max(l.width, x + 512);
      } else if (c.macro === "WarpWorld") {
        for (let i = 0; i < c.warps.length; i++) {
          add({ macro: "Pipe", x: (c.x || 0) + 8 + i * 32, height: 24 });
          l.decorations.push({
            type: "locked-warp",
            x: x + 32 + i * 64,
            y: 134,
            world: c.warps[i],
          });
        }
      } else if (c.thing === "Brick" || c.thing === "Block") {
        const content =
          {
            Mushroom: "power",
            Mushroom1Up: "oneup",
            Star: "star",
            Coin: "multi",
          }[c.contents] || (c.thing === "Block" ? "coin" : undefined);
        solid(c.thing === "Block" ? "question" : "brick", x, y, 16, 16, {
          ...(content ? { content } : {}),
          ...(c.hidden ? { hidden: true } : {}),
        });
      } else if (c.thing === "Stone" || c.thing === "CastleBlock") {
        solid(c.thing === "CastleBlock" ? "castle-block" : "stone", x, y, w, h);
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
      } else if (c.thing === "PipeVertical" || c.thing === "PipeHorizontal") {
        const t = solid(
          c.thing === "PipeHorizontal" ? "pipe-side" : "pipe",
          x,
          y,
          c.width ? w : 32,
          c.thing === "PipeHorizontal" ? 32 : h,
        );
        if (Number.isInteger(c.transport))
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
            y: y - 32,
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
      } else if (c.thing === "Coin")
        l.coins.push({ id: id("c"), x: x + 6, y: y + 7, zone });
      else if (c.thing === "Goomba" || c.thing === "Koopa")
        l.enemies.push({
          id: id("e"),
          type: c.thing.toLowerCase(),
          x,
          y,
          vx: -30,
          smart: !!c.smart,
          winged: !!c.jumping,
          floating: !!c.floating,
          begin: FLOOR - (c.end || 0) * 2,
          end: FLOOR - (c.begin || 0) * 2,
          zone,
        });
      else if (c.thing === "Platform")
        l.movers.push({
          id: id("m"),
          zone,
          type: "platform",
          x,
          y,
          w,
          h: 8,
          mode: c.floating ? "vertical" : "horizontal",
          begin: c.floating ? FLOOR - c.end * 2 : c.begin * 2,
          end: c.floating ? FLOOR - c.begin * 2 : c.end * 2,
          speed: 45,
        });
    }
    area.creation.forEach(add);
    if (l.goal?.type === "flag") {
      const last = l.platforms.filter((t) => t.type === "ground").at(-1);
      if (last && last.x + last.w < l.width) last.w = l.width - last.x;
    }
    return l;
  });
  const locations = map.locations.map((loc, i) => {
    const zone = loc.area || 0;
    return {
      zone,
      ...(zones[zone].decorations.find(
        (d) => d.type === "entrance" && d.location === i,
      ) || zones[zone].spawn),
    };
  });
  return {
    ...zones[0],
    id: stage,
    stage,
    title: `${stage} · 第一世界`,
    zones,
    locations,
    startZone: 0,
    time: map.time || 400,
  };
}
export function publicLevel(l) {
  const view = (z) => ({
    ...z,
    platforms: z.platforms.map(({ content, ...t }) => t),
  });
  return { ...view(l), zones: l.zones.map(view) };
}
