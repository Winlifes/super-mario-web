import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stepHorizontal, moveBody } from "../shared/motion.mjs";
import { createWorld, addPlayer, stepWorld } from "../shared/world.mjs";
const reference = JSON.parse(
  readFileSync(
    new URL("../docs/controls-reference-2026-11-24.json", import.meta.url),
  ),
);
for (const scenario of reference.scenarios)
  test(`source velocity trace: ${scenario.name}`, () => {
    const p = { vx: 0, facing: 1, ground: true, crouch: false };
    let frame = 0;
    for (const segment of scenario.segments)
      for (let tick = 0; tick < segment.ticks; tick++) {
        p.crouch = !!segment.crouch;
        stepHorizontal(p, segment, scenario.water);
        assert.ok(Math.abs(p.vx - scenario.velocity[frame++]) < 1e-10);
      }
  });
test("opposite input brakes before turning; releasing retains the original deceleration", () => {
  const p = { vx: 162, facing: 1, ground: true };
  stepHorizontal(p, { axis: -1, run: true });
  assert.ok(p.vx > 0);
  assert.equal(p.skidding, true);
  assert.equal(p.facing, 1);
  for (let i = 0; i < 30; i++) stepHorizontal(p, { axis: -1, run: true });
  assert.ok(p.vx < 0);
  assert.equal(p.facing, -1);
  const q = { vx: 162, facing: 1, ground: true };
  stepHorizontal(q, { axis: 0, run: false });
  assert.ok(q.vx > 150);
});
test("a descending side contact cannot snap the player onto a ledge; a real crossing lands", () => {
  const tile = { id: "t", x: 40, y: 80, w: 16, h: 16 };
  const w = {
    level: { zones: [{ platforms: [tile] }] },
    used: new Set(),
    broken: new Set(),
    movers: [],
  };
  const side = { x: 25, y: 86, w: 14, h: 16, vx: 162, vy: 120 };
  moveBody(w, side, 1 / 60, () => {});
  assert.ok(side.x + 14 <= 40);
  assert.ok(side.y > 80);
  assert.equal(side.ground, false);
  const landing = { x: 42, y: 62, w: 14, h: 16, vx: 0, vy: 240 };
  moveBody(w, landing, 1 / 60, () => {});
  assert.equal(landing.y, 64);
  assert.equal(landing.ground, true);
});
test("head contact cancels a held jump once and grounded big crouch uses source height", () => {
  const w = createWorld(),
    p = addPlayer(w, "a", 0);
  w.phase = "playing";
  w.enemies = [];
  const block = w.level.platforms.find((t) => t.content === "coin");
  p.x = block.x;
  p.y = block.y + 16;
  p.vy = -100;
  p.jumping = true;
  stepWorld(
    w,
    new Map([
      ["a", { axis: 0, jump: true, run: false, fire: false, down: false }],
    ]),
  );
  assert.equal(p.jumping, false);
  assert.ok(p.y >= block.y + 16);
  Object.assign(p, {
    x: 40,
    y: 176,
    form: 1,
    h: 32,
    vx: 0,
    vy: 0,
    ground: true,
    lastJump: false,
  });
  stepWorld(
    w,
    new Map([
      ["a", { axis: 0, jump: false, run: false, fire: false, down: true }],
    ]),
  );
  assert.equal(p.h, 22);
  assert.equal(p.y + p.h, 208);
});
