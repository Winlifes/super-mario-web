import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld, addPlayer, stepWorld } from "../server/world.mjs";
for (const stage of ["1-1", "1-2", "1-3", "1-4"])
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
    assert.equal(world.phase, stage === "1-4" ? "won" : "cleared");
    assert.equal(world.players.get("route").lives, 3);
    assert.equal(world.score, replay.score);
  });
