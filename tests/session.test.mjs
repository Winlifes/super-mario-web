import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createWorld,
  addPlayer,
  stepWorld,
  snapshot,
  startNextCycle,
  removePlayer,
} from "../shared/session.mjs";
import { makeLevel, stages } from "../shared/level.mjs";
import { TIMING, CHECKPOINT_RULES } from "../shared/rules.mjs";
import { travelTo } from "../shared/cutscenes.mjs";

const neutral = { axis: 0, jump: false, run: false, down: false, fire: false };
const inputs = (id, axis) => new Map([[id, { ...neutral, axis }]]);
function play(game) {
  for (let i = 0; i < 500 && ["countdown", "turn"].includes(game.phase); i++)
    stepWorld(game);
  assert.equal(game.phase, "playing");
}
function twoPlayers(stage = "1-1") {
  const game = createWorld(1, { stage, mode: "turns" });
  const a = addPlayer(game, "a", 0);
  const b = addPlayer(game, "b", 1);
  play(game);
  return { game, a, b };
}

test("turns ignore the waiting player's input and maintain separate score, coins and lives", () => {
  const { game, a, b } = twoPlayers();
  const replay = JSON.parse(
    readFileSync(new URL("../docs/input-route-1-1.json", import.meta.url)),
  );
  const bX = b.x;
  for (const action of replay.route.slice(0, 3))
    for (let tick = 0; tick < action.ticks; tick++)
      stepWorld(
        game,
        new Map([
          ["a", action],
          ["b", { ...neutral, axis: 1 }],
        ]),
      );
  const state = snapshot(game);
  assert.equal(state.activePlayerId, "a");
  assert.equal(state.players.length, 1);
  assert.equal(b.x, bX);
  assert.equal(state.standings[0].coins, 1);
  assert.equal(state.standings[1].coins, 0);
  assert.equal(state.standings[1].score, 0);
  assert.equal(state.standings[1].lives, 3);
  a.y = 280;
  stepWorld(game);
  assert.equal(game.phase, "turn");
  assert.equal(a.lives, 2);
  for (let tick = 0; tick < TIMING.respawn; tick++)
    stepWorld(game, inputs("a", 1));
  assert.equal(game.activeId, "b");
  assert.equal(a.alive, true);
  assert.equal(a.form, 0);
  play(game);
  const savedX = a.x;
  stepWorld(
    game,
    new Map([
      ["a", { ...neutral, axis: 1 }],
      ["b", { ...neutral, axis: 1 }],
    ]),
  );
  assert.equal(a.x, savedX);
  assert.ok(b.x > bX);
  b.y = 280;
  stepWorld(game);
  for (let tick = 0; tick < TIMING.respawn; tick++) stepWorld(game);
  assert.equal(game.activeId, "a");
  assert.equal(snapshot(game).coins, 1);
  assert.equal(b.lives, 2);
});

test("a natural course replay advances only that player's course and hands over control", () => {
  const { game } = twoPlayers();
  const replay = JSON.parse(
    readFileSync(new URL("../docs/input-route-1-1.json", import.meta.url)),
  );
  for (const action of replay.route)
    for (let tick = 0; tick < action.ticks; tick++)
      stepWorld(game, new Map([["a", action]]));
  assert.equal(game.phase, "cleared");
  for (let tick = 0; tick < 2400 && game.activeId === "a"; tick++)
    stepWorld(game);
  assert.equal(game.activeId, "b");
  assert.equal(game.runs.get("a").world.level.stage, "1-2");
  assert.equal(game.level.stage, "1-1");
  assert.equal(game.players.get("a").lives, 3);
  assert.equal(game.players.get("b").lives, 3);
});

test("turns freeze for an active reconnect, resume and recover when that seat leaves", () => {
  const { game, a, b } = twoPlayers();
  a.connected = false;
  const tick = game.tick;
  for (let i = 0; i < 180; i++) stepWorld(game, inputs("b", 1));
  assert.equal(game.phase, "waiting");
  assert.equal(game.tick, tick);
  a.connected = true;
  stepWorld(game, inputs("a", 1));
  assert.ok(game.tick > tick);
  removePlayer(game, "a");
  stepWorld(game);
  assert.equal(game.activeId, "b");
  assert.equal(game.players.size, 1);
  assert.equal(b.lives, 3);
  assert.equal(game.runs.has("a"), false);
});

test("an exhausted seat is skipped until both participants have lost their lives", () => {
  const { game, a, b } = twoPlayers();
  a.lives = 1;
  a.y = 280;
  stepWorld(game);
  for (let i = 0; i < TIMING.respawn; i++) stepWorld(game);
  assert.equal(game.activeId, "b");
  play(game);
  b.lives = 1;
  b.y = 280;
  stepWorld(game);
  for (let i = 0; i < TIMING.respawn; i++) stepWorld(game);
  assert.equal(game.phase, "lost");
  assert.ok(snapshot(game).standings.every((p) => p.lives === 0));
});

test("a timeout in a turn charges only the active seat", () => {
  const { game, a, b } = twoPlayers();
  game.world.time = 0.01;
  stepWorld(game);
  assert.equal(a.lives, 2);
  assert.equal(b.lives, 3);
  for (let i = 0; i < TIMING.respawn; i++) stepWorld(game);
  assert.equal(game.activeId, "b");
  assert.equal(game.world.time, 400);
});

test("a completed final course opens another cycle through the public progression API", () => {
  const game = createWorld(1, { stage: "8-4" });
  const player = addPlayer(game, "route", 0);
  const replay = JSON.parse(
    readFileSync(new URL("../docs/input-route-8-4.json", import.meta.url)),
  );
  play(game);
  for (const action of replay.route)
    for (let tick = 0; tick < action.ticks; tick++)
      stepWorld(game, new Map([["route", action]]));
  for (let tick = 0; tick < 2400 && game.phase !== "won"; tick++)
    stepWorld(game);
  assert.equal(game.phase, "won");
  const score = game.score;
  const coins = game.coins;
  assert.equal(startNextCycle(game), true);
  assert.equal(game.cycle, 2);
  assert.equal(game.level.stage, "1-1");
  assert.equal(game.phase, "countdown");
  assert.equal(game.score, score);
  assert.equal(game.coins, coins);
  assert.equal(player.lives, 3);
  assert.equal(startNextCycle(game), false);
});

test("the second cycle increases horizontal enemy movement while retaining the player's controls", () => {
  const games = [1, 2].map((cycle) => {
    const game = createWorld(1, { cycle });
    addPlayer(game, "a", 0);
    play(game);
    return game;
  });
  const initial = games[0].enemies[0].x;
  for (const game of games) stepWorld(game, inputs("a", 1));
  const [normal, harder] = games.map((game) =>
    Math.abs(game.enemies[0].x - initial),
  );
  assert.ok(Math.abs(harder / normal - 1.15) < 0.001);
  assert.equal(games[0].players.get("a").x, games[1].players.get("a").x);
});

test("a final-course turn replay starts the next cycle for that player before handing over", () => {
  const { game } = twoPlayers("8-4");
  const replay = JSON.parse(
    readFileSync(new URL("../docs/input-route-8-4.json", import.meta.url)),
  );
  for (const action of replay.route)
    for (let tick = 0; tick < action.ticks; tick++)
      stepWorld(game, new Map([["a", action]]));
  for (let tick = 0; tick < 2400 && game.activeId === "a"; tick++)
    stepWorld(game);
  assert.equal(game.activeId, "b");
  const standings = snapshot(game).standings;
  assert.equal(standings.find((p) => p.id === "a").cycle, 2);
  assert.equal(standings.find((p) => p.id === "a").stage, "1-1");
  assert.equal(standings.find((p) => p.id === "b").cycle, 1);
  assert.equal(game.level.stage, "8-4");
});

test("a collected checkpoint survives a bonus visit and supplies a safe respawn position", () => {
  const game = createWorld(1);
  const player = addPlayer(game, "a", 0);
  game.phase = "playing";
  game.enemies = [];
  const checkpoint = game.level.checkpoints[0];
  Object.assign(player, {
    x: checkpoint.x + CHECKPOINT_RULES.activationDistance + 1,
    y: 192,
  });
  stepWorld(game);
  assert.equal(player.checkpoint, checkpoint.x);
  assert.equal(player.checkpointY, checkpoint.y);
  travelTo(game, player, game.level.zones[0].portals[0].target, false);
  assert.equal(player.zone, 1);
  assert.equal(player.checkpoint, checkpoint.x);
  player.y = 280;
  stepWorld(game);
  for (let i = 0; i < TIMING.respawn; i++) stepWorld(game);
  assert.equal(player.zone, 0);
  assert.equal(player.x, checkpoint.x);
  assert.equal(player.y, checkpoint.y);
  assert.equal(player.alive, true);
});

test("computed checkpoint positions have standing clearance and a floor in every configured zone", () => {
  let checked = 0;
  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (const stage of stages)
    for (const zone of makeLevel(1, stage).zones)
      for (const checkpoint of zone.checkpoints) {
        const body = {
          x: checkpoint.x,
          y: checkpoint.y + 16 - CHECKPOINT_RULES.clearanceHeight,
          w: 14,
          h: CHECKPOINT_RULES.clearanceHeight,
        };
        assert.ok(
          zone.platforms.some(
            (tile) =>
              tile.type === "ground" &&
              tile.y === checkpoint.y + 16 &&
              tile.x <= body.x &&
              tile.x + tile.w >= body.x + body.w,
          ),
          `${stage} zone ${zone.zone}`,
        );
        assert.ok(
          !zone.platforms.some((tile) => !tile.hidden && overlaps(body, tile)),
          `${stage} zone ${zone.zone}`,
        );
        checked++;
      }
  assert.ok(checked >= 20);
});
