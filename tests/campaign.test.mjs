import test from "node:test";
import assert from "node:assert/strict";
import { makeLevel, stages, publicLevel } from "../shared/level.mjs";
import {
  createWorld,
  addPlayer,
  stepWorld,
  snapshot,
} from "../server/world.mjs";
const command = (axis = 0, jump = false, extra = {}) => ({
  axis,
  jump,
  run: false,
  fire: false,
  down: false,
  ...extra,
});
const run = (w, n, input = new Map()) => {
  for (let i = 0; i < n; i++) stepWorld(w, input);
};

test("source map coordinates include the original gaps, hidden 1UP, two coin rooms, moving platforms and castle firebars", () => {
  const first = makeLevel(1, "1-1");
  assert.ok(
    first.platforms.some(
      (t) => t.x === 256 && t.y === 144 && t.type === "question",
    ),
  );
  assert.ok(
    first.platforms.some(
      (t) => t.x === 448 && t.y === 176 && t.type === "pipe",
    ),
  );
  assert.ok(
    first.platforms.some(
      (t) => t.x === 1024 && t.hidden && t.content === "oneup",
    ),
  );
  assert.deepEqual(
    first.platforms
      .filter((t) => t.type === "ground")
      .slice(0, 3)
      .map((t) => [t.x, t.w]),
    [
      [0, 1104],
      [1136, 240],
      [1424, 1024],
    ],
  );
  assert.equal(first.zones[1].coins.length, 19);
  assert.equal(makeLevel(1, "1-2").zones[2].coins.length, 17);
  assert.equal(makeLevel(1, "1-3").movers.length, 4);
  assert.equal(
    makeLevel(1, "1-4").hazards.filter((h) => h.type === "firebar").length,
    7,
  );
  assert.ok(publicLevel(first).platforms.every((t) => !("content" in t)));
});

test("campaign transitions preserve team score, coins, lives and forms, with a distinct stage revision", () => {
  const w = createWorld(5),
    p = addPlayer(w, "a", 0);
  addPlayer(w, "b", 1);
  p.lives = 2;
  p.form = 2;
  p.h = 32;
  w.coins = 7;
  for (const stage of stages.slice(0, 3)) {
    assert.equal(w.level.stage, stage);
    w.phase = "playing";
    const z = w.level.zones.find((z) => z.goal);
    p.zone = z.zone;
    p.x = z.goal.x;
    p.y = 160;
    stepWorld(w);
    assert.equal(w.phase, "cleared");
    const score = w.score;
    run(w, 180);
    assert.equal(w.phase, "countdown");
    assert.equal(w.score, score);
    assert.equal(p.form, 2);
    assert.equal(p.lives, 2);
    assert.equal(w.coins, 7);
  }
  assert.equal(w.level.stage, "1-4");
  assert.equal(w.revision, 4);
});

test("down enters the original coin room, right returns through its exit, shared mutations remain intact", () => {
  const w = createWorld(1),
    a = addPlayer(w, "a", 0),
    b = addPlayer(w, "b", 1);
  w.phase = "playing";
  const pipe = w.level.zones[0].portals[0];
  a.x = pipe.x + 8;
  a.y = pipe.y - 16;
  a.ground = true;
  stepWorld(w, new Map([["a", command(0, false, { down: true })]]));
  assert.equal(a.zone, 1);
  assert.equal(b.zone, 0);
  const coin = w.level.zones[1].coins[0];
  a.x = coin.x - 5;
  a.y = coin.y - 7;
  stepWorld(w);
  assert.ok(w.taken.has(coin.id));
  run(w, 65);
  const exit = w.level.zones[1].portals[0];
  a.x = exit.x - 14;
  a.y = exit.y + 16;
  stepWorld(w, new Map([["a", command(1)]]));
  assert.equal(a.zone, 0);
  assert.ok(a.x > 2600);
  assert.ok(w.taken.has(coin.id));
  assert.equal(snapshot(w).players.find((p) => p[0] === "b")[11], 0);
});

test("stomping a Koopa produces a shell; kicking it kills enemies with increasing combo scores", () => {
  const w = createWorld(1),
    p = addPlayer(w, "a", 0);
  w.phase = "playing";
  const e = w.enemies.find((e) => e.type === "koopa");
  e.x = 100;
  e.y = 184;
  e.zone = 0;
  e.vx = 0;
  e.active = true;
  w.enemies = [e];
  p.x = 100;
  p.y = 167;
  p.vy = 120;
  p.ground = false;
  stepWorld(w);
  assert.equal(e.state, "idle");
  assert.equal(e.h, 14);
  assert.ok(p.vy < 0);
  p.x = 40;
  p.y = 192;
  run(w, 14);
  p.x = e.x - 13;
  p.y = 192;
  stepWorld(w, new Map([["a", command(1)]]));
  assert.equal(e.state, "moving");
  assert.ok(e.vx > 0);
  const score = w.score;
  w.enemies.push(
    {
      ...e,
      id: "target1",
      type: "goomba",
      state: "walk",
      x: 160,
      y: 194,
      w: 14,
      h: 14,
      vx: 0,
      dead: 0,
    },
    {
      ...e,
      id: "target2",
      type: "goomba",
      state: "walk",
      x: 198,
      y: 194,
      w: 14,
      h: 14,
      vx: 0,
      dead: 0,
    },
  );
  run(w, 30);
  assert.ok(w.enemies.slice(1).every((e) => e.dead));
  assert.ok(w.score >= score + 900);
});

test("fire form damage returns to small; stars protect; hidden blocks and 1UP are authoritative", () => {
  const w = createWorld(1),
    p = addPlayer(w, "a", 0);
  w.phase = "playing";
  const hidden = w.level.platforms.find((t) => t.hidden);
  p.x = hidden.x;
  p.y = hidden.y + 16;
  p.vy = -100;
  stepWorld(w);
  assert.ok(w.used.has(hidden.id));
  assert.equal(w.items[0].type, "oneup");
  p.x = w.items[0].x;
  p.y = w.items[0].y;
  stepWorld(w);
  assert.equal(p.lives, 4);
  p.x = 70;
  p.y = 176;
  p.form = 2;
  p.h = 32;
  p.invincibleUntil = 0;
  const e = w.enemies[0];
  Object.assign(e, { x: 70, y: 194, vx: 0, active: true });
  w.enemies = [e];
  stepWorld(w);
  assert.equal(p.form, 0);
  assert.equal(p.h, 16);
  p.starUntil = w.tick + 60;
  p.invincibleUntil = 0;
  e.dead = 0;
  e.x = p.x;
  e.y = p.y;
  stepWorld(w);
  assert.ok(e.dead);
  assert.equal(p.lives, 4);
});

test("a moving platform carries a standing player and remains identical in snapshots", () => {
  const w = createWorld(1, { stage: "1-3" }),
    p = addPlayer(w, "a", 0);
  w.phase = "playing";
  const m = w.movers.find((m) => m.mode === "horizontal");
  p.x = m.x + 8;
  p.y = m.y - 16;
  p.ground = true;
  p.riding = m.id;
  const initial = m.x,
    offset = p.x - m.x;
  run(w, 35);
  assert.notEqual(m.x, initial);
  assert.ok(Math.abs(p.x - m.x - offset) < 1);
  assert.ok(p.ground);
  assert.equal(
    snapshot(w).movers.find((a) => a[0] === m.id)[1],
    Math.round(m.x * 10) / 10,
  );
});

test("Bowser takes five player fireballs; axe opens bridge and reaching Toad completes first world", () => {
  const w = createWorld(1, { stage: "1-4" }),
    p = addPlayer(w, "a", 0);
  w.phase = "playing";
  const boss = w.enemies[0];
  p.x = boss.x - 70;
  p.y = 128;
  p.form = 2;
  p.h = 32;
  p.invincibleUntil = 99999;
  for (let i = 0; i < 180 && !boss.dead; i++)
    stepWorld(w, new Map([["a", command(0, false, { fire: i % 20 === 0 })]]));
  assert.equal(boss.hits, 5);
  assert.ok(boss.dead);
  assert.ok(w.score >= 5000);
  p.x = w.level.axe.x;
  p.y = w.level.axe.y;
  stepWorld(w);
  assert.equal(w.phase, "bridge");
  assert.ok(w.bridgeOpened);
  assert.ok(
    w.level.platforms
      .filter((t) => t.type === "bridge")
      .every((t) => w.broken.has(t.id)),
  );
  run(w, 120);
  p.x = w.level.goal.x;
  p.y = 176;
  stepWorld(w);
  assert.equal(w.phase, "won");
});
