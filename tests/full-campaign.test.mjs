import test from "node:test";
import assert from "node:assert/strict";
import { makeLevel, stages } from "../shared/level.mjs";
import {
  createWorld,
  addPlayer,
  stepWorld,
  snapshot,
} from "../server/world.mjs";
const input = (axis = 0, jump = false, extra = {}) => ({
  axis,
  jump,
  fire: false,
  down: false,
  run: true,
  ...extra,
});
function run(w, n, command = input()) {
  for (let i = 0; i < n; i++) stepWorld(w, new Map([["a", command]]));
}
function playing(stage) {
  const w = createWorld(1, { stage }),
    p = addPlayer(w, "a", 0);
  while (w.phase === "countdown") stepWorld(w);
  return { w, p };
}

test("all 32 original maps compile with finite geometry and connected original transports", () => {
  assert.equal(stages.length, 32);
  for (const stage of stages) {
    const l = makeLevel(1, stage),
      reachable = new Set([0]);
    for (const z of l.zones) {
      for (const t of [...z.platforms, ...z.movers, ...z.enemies, ...z.coins]) {
        assert.ok(
          Number.isFinite(t.x) && Number.isFinite(t.y),
          `${stage} coordinate`,
        );
        if ("w" in t) assert.ok(Number.isFinite(t.w) && t.w > 0);
      }
      for (const portal of z.portals) {
        if (typeof portal.target === "object")
          assert.ok(stages.includes(portal.target.map));
        else assert.ok(l.locations[portal.target], stage);
      }
    }
    for (let i = 0; i < l.zones.length + 1; i++)
      for (const n of [...reachable]) {
        const z = l.zones[n],
          targets = [
            ...z.portals.map((p) => p.target),
            ...z.platforms
              .filter((t) => t.content === "vine")
              .map((t) => t.transport),
            z.exit,
          ].filter((t) => Number.isInteger(t));
        for (const t of targets) reachable.add(l.locations[t].zone);
      }
    assert.ok(
      l.zones.some((z) => reachable.has(z.zone) && z.goal),
      `${stage} ending reachable from source transport graph`,
    );
    if (stage.endsWith("-4")) assert.ok(l.zones.some((z) => z.axe));
  }
});

test("the full 32-course campaign advances through staged endings and only 8-4 wins", () => {
  const { w, p } = playing("1-1");
  p.form = 2;
  p.h = 32;
  p.lives = 2;
  w.coins = 17;
  for (let i = 0; i < stages.length; i++) {
    assert.equal(w.level.stage, stages[i]);
    w.phase = "playing";
    const z = w.level.zones.find((z) => z.goal);
    p.zone = z.zone;
    p.x = z.axe?.x ?? z.goal.x;
    p.y = z.axe?.y ?? 144;
    const revision = w.revision;
    stepWorld(w);
    assert.ok(["cleared", "bridge"].includes(w.phase), stages[i]);
    const phases = new Set();
    for (
      let t = 0;
      t < 2200 && w.revision === revision && w.phase !== "won";
      t++
    ) {
      phases.add(w.cutscene?.phase);
      stepWorld(
        w,
        new Map([["a", input(-1, true, { fire: true, down: true })]]),
      );
    }
    if (stages[i].endsWith("-4")) {
      assert.ok(phases.has("bridge") && phases.has("dialog"), stages[i]);
    } else
      for (const phase of ["slide", "salute", "walk", "count", "fireworks"])
        assert.ok(phases.has(phase), phase);
    assert.equal(p.lives, 2);
    assert.equal(p.form, 2);
    assert.equal(w.coins, 17);
    assert.equal(w.phase, i === 31 ? "won" : "countdown");
  }
});

test("flag rewards count down once, fireworks follow saved final digit, and teammates share one timeline", () => {
  const { w, p } = playing("2-1"),
    b = addPlayer(w, "b", 1);
  b.zone = 2;
  w.time = 316;
  p.x = w.level.goal.x;
  p.y = 48;
  stepWorld(w);
  assert.equal(w.phase, "cleared");
  assert.equal(b.zone, 0);
  assert.equal(w.cutscene.fireworks, 6);
  const initial = w.score,
    seen = new Set(),
    revision = w.revision;
  for (let i = 0; i < 1800 && w.revision === revision; i++) {
    stepWorld(w);
    for (const e of w.events) if (e.type === "firework") seen.add(e.id);
  }
  assert.equal(seen.size, 6);
  assert.equal(w.score, initial + 316 * 50 + 6 * 500);
  assert.equal(w.level.stage, "2-2");
});

test("water uses repeated swim strokes and does not grant land stomps", () => {
  const { w, p } = playing("2-2");
  run(w, 180);
  assert.equal(p.zone, 1);
  p.x = 220;
  p.y = 120;
  p.vx = p.vy = 0;
  w.enemies = [];
  const bottom = p.y;
  run(w, 1, input(0, true));
  assert.ok(p.vy < 0);
  run(w, 18, input());
  const upper = p.y;
  assert.ok(upper < bottom);
  run(w, 1, input(0, true));
  assert.ok(p.vy < 0);
  assert.equal(snapshot(w).players[0][14], "swim");
});

test("vine blocks grow a climbable route to the original sky exit without resetting coins", () => {
  const { w, p } = playing("2-1");
  w.enemies = [];
  const block = w.level.platforms.find((t) => t.content === "vine");
  p.x = block.x;
  p.y = block.y + 16;
  p.vy = -100;
  stepWorld(w);
  assert.equal(w.vines.length, 1);
  assert.ok(w.used.has(block.id));
  run(w, 60);
  const v = w.vines[0];
  p.x = v.x;
  p.y = v.y + 12;
  p.ground = false;
  p.vy = 0;
  run(w, 1, input(0, true));
  assert.equal(p.climbing, v.id);
  for (let i = 0; i < 500 && p.zone === 0; i++) run(w, 1, input(0, true));
  assert.equal(p.zone, 1);
  assert.equal(w.level.zones[1].sky, true);
  assert.equal(p.lives, 3);
  run(w, 150);
  w.coins = 9;
  p.y = 280;
  stepWorld(w);
  assert.equal(p.zone, 0);
  assert.ok(p.x > 2500);
  assert.equal(w.coins, 9);
  assert.equal(p.lives, 3);
});

test("warp pipes move the whole team into an actual later world and preserve progress", () => {
  const { w, p } = playing("1-2"),
    b = addPlayer(w, "b", 1);
  const z = w.level.zones.find((z) => z.portals.some((p) => p.target?.map)),
    tube = z.portals.find((p) => p.target?.map === "4-1");
  p.autoEntrance = false;
  p.zone = z.zone;
  p.x = tube.x + 8;
  p.y = tube.y - 16;
  p.ground = true;
  w.coins = 12;
  b.form = 1;
  b.h = 32;
  stepWorld(w, new Map([["a", input(0, false, { down: true })]]));
  assert.equal(w.phase, "warp");
  run(w, 65);
  assert.equal(w.level.stage, "4-1");
  assert.equal(w.players.size, 2);
  assert.equal(b.zone, 0);
  assert.equal(b.form, 1);
  assert.equal(w.coins, 12);
});

test("castle maze failure repeats its corridor; the upper pass unlocks the next section", () => {
  for (const pass of [false, true]) {
    const { w, p } = playing("4-4");
    w.enemies = [];
    w.level.zones[0].hazards = [];
    const trigger = w.level.triggers.find(
      (t) => t.type === (pass ? "maze-pass" : "maze-fail"),
    );
    p.x = trigger.x;
    p.y = trigger.y + 2;
    p.vx = p.vy = 0;
    p.ground = false;
    stepWorld(w);
    assert.equal(p.mazePassed, pass);
    const decider = w.level.triggers.find((t) => t.type === "maze-decide");
    p.x = decider.x;
    p.y = 112;
    p.vx = p.vy = 0;
    stepWorld(w);
    assert.ok(Math.abs(p.x - w.level.sections[pass ? 1 : 0].x) < 4);
  }
});

test("a scale carries its rider and moves its partner in the opposite direction", () => {
  const { w, p } = playing("3-3");
  w.enemies = [];
  const a = w.movers.find((m) => m.mode === "scale"),
    b = w.movers.find((m) => m.group === a.group && m !== a),
    ay = a.y,
    by = b.y;
  p.x = a.x + 6;
  p.y = a.y - 16;
  p.riding = a.id;
  p.ground = true;
  run(w, 20, input());
  assert.ok(a.y > ay);
  assert.ok(b.y < by);
  assert.ok(Math.abs(a.y - ay + b.y - by) < 0.01);
  assert.ok(Math.abs(p.y + 16 - a.y) < 1);
});

test("later-world enemies spawn real projectiles and beetles survive fire", () => {
  const { w, p } = playing("7-1");
  p.invincibleUntil = 99999;
  const bro = w.enemies.find((e) => e.type === "hammerbro");
  p.x = bro.x - 50;
  p.y = bro.y;
  run(w, 60);
  assert.ok(w.hammers.length > 0);
  const { w: l, p: q } = playing("4-1"),
    lakitu = l.enemies.find((e) => e.type === "lakitu");
  q.x = lakitu.x - 40;
  q.invincibleUntil = 99999;
  run(l, 150);
  assert.ok(l.enemies.some((e) => ["spiny", "spiny-egg"].includes(e.type)));
  const { w: k, p: r } = playing("8-1"),
    beetle = k.enemies.find((e) => e.type === "beetle");
  r.form = 2;
  r.h = 32;
  r.x = beetle.x - 50;
  r.y = 176;
  r.invincibleUntil = 99999;
  run(k, 30, input(0, false, { fire: true }));
  assert.equal(beetle.dead, 0);
});
