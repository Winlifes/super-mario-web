import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, addPlayer, stepWorld } from "../shared/world.mjs";

const control = (axis = 0, extra = {}) =>
  new Map([
    [
      "a",
      { axis, jump: false, run: false, down: false, fire: false, ...extra },
    ],
  ]);

function playground() {
  const world = createWorld(1, { stage: "meadow" });
  world.phase = "playing";
  world.enemies = [];
  world.movers = [];
  const area = world.level.zones[0];
  Object.assign(area, {
    platforms: [
      { id: "floor", type: "ground", x: 0, y: 208, w: 800, h: 32, zone: 0 },
    ],
    coins: [],
    hazards: [],
    triggers: [],
    goal: null,
  });
  const player = addPlayer(world, "a", 0);
  Object.assign(player, { x: 100, y: 192, ground: true });
  return { world, player, area };
}

test("power-ups fit under low ceilings and the powered player can crawl out", () => {
  for (const [gap, compactHeight] of [
    [16, 16],
    [24, 22],
  ]) {
    const { world, player, area } = playground();
    const ceiling = {
      id: "ceiling",
      x: 65,
      y: 208 - gap - 16,
      w: 80,
      h: 16,
      zone: 0,
    };
    area.platforms.push(ceiling);
    world.items.push({
      id: "mushroom",
      type: "mushroom",
      zone: 0,
      x: player.x,
      y: player.y,
      w: 14,
      h: 16,
      vx: 0,
      vy: 0,
    });
    stepWorld(world);
    assert.equal(player.form, 1);
    assert.equal(player.h, compactHeight);
    assert.equal(player.y + player.h, 208);
    assert.ok(player.y >= ceiling.y + ceiling.h);
    assert.equal(world.items.length, 0);
    for (let i = 0; i < 100 && player.crouch; i++) stepWorld(world, control(1));
    assert.ok(player.x >= ceiling.x + ceiling.w);
    assert.equal(player.h, 32);
    assert.equal(player.crouch, false);
    assert.equal(player.y + player.h, 208);
  }
});

test("a fire flower grows a small player before enabling fire shots", () => {
  const { world, player } = playground();
  for (const form of [1, 2, 2]) {
    world.items.push({
      id: `flower-${world.tick}`,
      type: "flower",
      zone: 0,
      x: player.x,
      y: player.y,
      w: 14,
      h: 16,
    });
    stepWorld(world);
    assert.equal(player.form, form);
    assert.equal(world.items.length, 0);
  }
  assert.equal(world.score, 3000);
});

test("a timeout costs one life, resumes at the checkpoint and ends on the last life", () => {
  const { world, player } = playground();
  Object.assign(player, { lives: 2, checkpoint: 80, form: 2, h: 32 });
  world.time = 0.01;
  world.coins = 8;
  world.score = 1600;
  stepWorld(world);
  assert.equal(world.phase, "timeout");
  assert.equal(world.time, 0);
  assert.equal(player.lives, 1);
  assert.equal(player.alive, false);

  for (let i = 0; i < 119; i++) stepWorld(world);
  assert.equal(world.phase, "timeout");
  assert.equal(player.alive, false);
  assert.equal(player.lives, 1);
  stepWorld(world);
  assert.equal(world.phase, "playing");
  assert.equal(world.time, 300);
  assert.equal(player.x, player.checkpoint);
  assert.equal(player.alive, true);
  assert.equal(player.form, 0);
  assert.equal(world.coins, 8);
  assert.equal(world.score, 1600);

  world.time = 0.01;
  stepWorld(world);
  assert.equal(world.phase, "lost");
  assert.equal(player.lives, 0);
  assert.equal(player.alive, false);
});

test("a team timeout charges each active player once and preserves offline and pending lives", () => {
  const { world, player } = playground();
  const teammate = addPlayer(world, "b", 1);
  const offline = addPlayer(world, "c", 2);
  const waiting = addPlayer(world, "d", 3);
  offline.connected = false;
  Object.assign(waiting, { alive: false, lives: 2, respawnAt: 50 });
  world.time = 0.01;
  stepWorld(world);
  assert.equal(world.phase, "timeout");
  assert.deepEqual([player, teammate, offline, waiting].map((p) => p.lives), [
    2, 2, 3, 2,
  ]);
  for (let i = 0; i < 120; i++) stepWorld(world);
  assert.equal(world.phase, "playing");
  assert.equal(world.time, 300);
  assert.equal(offline.connected, false);
  assert.ok([player, teammate, offline, waiting].every((p) => p.alive));
  assert.deepEqual([player, teammate, offline, waiting].map((p) => p.lives), [
    2, 2, 3, 2,
  ]);
  assert.equal(world.events.filter((e) => e.type === "timeup").length, 1);
});

test("a new attempt starts with a fresh timer and maze route after a solo death", () => {
  const { world, player } = playground();
  world.time = 25;
  Object.assign(player, {
    y: 280,
    mazePassed: true,
    mazeSection: 2,
    mazeAt: 30,
    mazeTrigger: "route",
  });
  stepWorld(world);
  const pausedTime = world.time;
  for (let i = 0; i < 60; i++) stepWorld(world);
  assert.equal(world.time, pausedTime);
  for (let i = 0; i < 60; i++) stepWorld(world);
  assert.equal(player.alive, true);
  assert.equal(world.time, 300);
  assert.equal(player.mazePassed, false);
  assert.equal(player.mazeSection, 0);
  assert.equal(player.mazeAt, 0);
  assert.equal(player.mazeTrigger, null);
});

test("a reserved reconnect keeps the run available after the last online life is lost", () => {
  const { world, player } = playground();
  const peer = addPlayer(world, "b", 1);
  player.connected = false;
  Object.assign(peer, { lives: 1, y: 280 });
  stepWorld(world);
  assert.equal(peer.lives, 0);
  assert.equal(world.phase, "playing");
  const time = world.time;
  stepWorld(world);
  assert.equal(world.time, time);
  player.connected = true;
  stepWorld(world, control(1));
  assert.equal(world.phase, "playing");
  assert.ok(player.x > 100);
  assert.ok(world.time < time);
});

test("changing stages keeps surviving power-ups and clears the form of a player awaiting respawn", () => {
  const world = createWorld(1, { stage: "1-1" });
  const fallen = addPlayer(world, "a", 0);
  const leader = addPlayer(world, "b", 1);
  world.phase = "playing";
  world.enemies = [];
  world.time = 10;
  Object.assign(fallen, { form: 2, h: 32, y: 280 });
  Object.assign(leader, { form: 1, h: 32, x: world.level.goal.x, y: 176 });
  stepWorld(world);
  assert.equal(fallen.alive, false);
  assert.equal(world.phase, "cleared");
  const revision = world.revision;
  for (let i = 0; i < 1200 && world.revision === revision; i++) stepWorld(world);
  assert.equal(world.level.stage, "1-2");
  assert.equal(fallen.alive, true);
  assert.equal(fallen.lives, 2);
  assert.equal(fallen.form, 0);
  assert.equal(fallen.h, 16);
  assert.equal(leader.form, 1);
});

test("a loop platform releases its riders when it reenters from the other edge", () => {
  for (const [y, speed, wrappedY] of [
    [239, 120, -16],
    [-15, -120, 240],
  ]) {
    const { world, player, area } = playground();
    area.platforms = [];
    const platform = {
      id: "loop",
      zone: 0,
      x: 100,
      y,
      w: 32,
      h: 8,
      mode: "loop",
      speed,
      dx: 0,
      dy: 0,
    };
    world.movers.push(platform);
    player.riding = platform.id;
    player.y = platform.y - player.h;
    const oldY = player.y;
    stepWorld(world);
    assert.equal(platform.y, wrappedY);
    assert.equal(platform.dy, 0);
    assert.equal(player.riding, null);
    assert.equal(player.ground, false);
    assert.ok(player.y > oldY && player.y < oldY + 1);
  }
});

test("descending into an enemy's side hurts, while crossing its top is a stomp", () => {
  for (const fromAbove of [false, true]) {
    const { world, player } = playground();
    const enemy = {
      id: "enemy",
      type: "goomba",
      zone: 0,
      x: 100,
      y: 194,
      w: 14,
      h: 14,
      vx: 0,
      vy: 0,
      active: true,
      dead: 0,
      state: "walk",
    };
    world.enemies.push(enemy);
    Object.assign(
      player,
      fromAbove
        ? { x: 100, y: 176.5, vy: 120, ground: false }
        : { x: 85, y: 184, vx: 120, vy: 60, ground: false },
    );
    stepWorld(world);
    assert.equal(Boolean(enemy.dead), fromAbove);
    assert.equal(player.alive, fromAbove);
    assert.equal(world.score, fromAbove ? 100 : 0);
  }
});

test("a suppressed pipe hazard stays under the pipe until a later emergence", () => {
  const { world, player, area } = playground();
  area.platforms.push({ id: "pipe", x: 100, y: 160, w: 32, h: 48, zone: 0 });
  const plant = {
    id: "plant",
    type: "piranha",
    zone: 0,
    x: 104,
    y: 162,
    pipeY: 160,
    homeX: 0,
    w: 14,
    h: 24,
    vx: 0,
    vy: 0,
    active: true,
    dead: 0,
  };
  world.enemies.push(plant);
  Object.assign(player, { x: 104, y: 144 });
  for (let i = 0; i < 100; i++) stepWorld(world);
  assert.equal(player.lives, 3);
  assert.equal(plant.hidden, true);
  for (let i = 0; i < 100; i++) stepWorld(world, control(1));
  assert.ok(player.x > 190);
  assert.equal(plant.hidden, true);
  for (let i = 0; i < 130; i++) stepWorld(world);
  assert.equal(plant.hidden, false);
  assert.equal(player.lives, 3);
});

test("a disconnected player keeps their place without picking up coins or pausing the timer", () => {
  const { world, player, area } = playground();
  const peer = addPlayer(world, "b", 1);
  peer.x = 300;
  area.coins.push({ id: "coin", x: 104, y: 197 });
  Object.assign(player, { connected: false, vx: 96, autoEntrance: true });
  const time = world.time;
  stepWorld(world, control(1));
  assert.equal(player.x, 100);
  assert.equal(world.coins, 0);
  assert.ok(world.time < time);
  player.connected = true;
  player.autoEntrance = false;
  stepWorld(world);
  assert.equal(world.coins, 1);
  assert.equal(world.score, 200);
});

test("the team's 100th coin schedules a real respawn for a player with no lives", () => {
  const { world, player, area } = playground();
  const eliminated = addPlayer(world, "b", 1);
  Object.assign(eliminated, { alive: false, lives: 0, respawnAt: 0 });
  world.coins = 99;
  area.coins.push({ id: "coin", x: 104, y: 197 });
  stepWorld(world);
  assert.equal(world.coins, 100);
  assert.equal(player.lives, 4);
  assert.equal(eliminated.lives, 1);
  for (let i = 0; i < 120; i++) stepWorld(world);
  assert.equal(eliminated.alive, true);
});

test("a finish flag requires contact with its reachable height", () => {
  const { world, player, area } = playground();
  area.goal = { type: "flag", x: 120, y: 56, poleBottom: 192, groundY: 208 };
  player.x = 120;
  player.y = 224;
  stepWorld(world);
  assert.equal(world.phase, "playing");
  player.x = 150;
  player.y = 192;
  stepWorld(world);
  assert.equal(world.phase, "playing");
  player.x = 116;
  stepWorld(world);
  assert.equal(world.phase, "cleared");
});

test("a crouched player resumes at the correct height through a pipe and can regain control after a disconnect", () => {
  const world = createWorld(1);
  const player = addPlayer(world, "a", 0);
  addPlayer(world, "b", 1);
  world.phase = "playing";
  world.enemies = [];
  const entrance = world.level.zones[0].portals[0];
  Object.assign(player, {
    x: entrance.x + 8,
    y: entrance.y - 32,
    ground: true,
    form: 1,
    h: 32,
  });
  stepWorld(world, control(0, { down: true }));
  assert.equal(player.h, 22);
  assert.ok(player.transit);
  player.connected = false;
  for (let i = 0; i < 90; i++) stepWorld(world);
  assert.equal(player.zone, 0);
  player.connected = true;
  stepWorld(world);
  assert.equal(player.zone, 0);
  for (let i = 0; i < 66 && player.zone === 0; i++) stepWorld(world);
  assert.equal(player.zone, 1);
  assert.equal(player.h, 32);
  assert.equal(player.crouch, false);
  assert.equal(player.y + player.h, 32);
});
