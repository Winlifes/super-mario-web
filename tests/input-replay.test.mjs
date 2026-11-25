import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld, addPlayer, stepWorld } from "../server/world.mjs";
for (const stage of [
  "1-1",
  "1-2",
  "1-3",
  "1-4",
  "2-2",
  "3-3",
  "4-1",
  "4-4",
  "7-4",
  "8-4",
])
  test(`${stage} normal-spawn input replay reaches its ending without losing a life`, () => {
    const replay = JSON.parse(
      readFileSync(
        new URL(`../docs/input-route-${stage}.json`, import.meta.url),
        "utf8",
      ),
    );
    const world = createWorld(1, { stage });
    addPlayer(world, "route", 0);
    while (world.phase === "countdown") stepWorld(world);
    for (const action of replay.route)
      for (let i = 0; i < action.ticks; i++)
        stepWorld(world, new Map([["route", action]]));
    assert.equal(world.phase, stage.endsWith("-4") ? "bridge" : "cleared");
    assert.equal(world.players.get("route").lives, 3);
    assert.equal(world.score, replay.score);
    const revision = world.revision;
    for (
      let tick = 0;
      tick < 2400 && world.revision === revision && world.phase !== "won";
      tick++
    )
      stepWorld(world);
    assert.equal(world.phase, stage === "8-4" ? "won" : "countdown");
    assert.equal(world.players.get("route").lives, 3);
  });
