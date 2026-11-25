import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import {
  createWorld,
  addPlayer,
  stepWorld,
  snapshot,
} from "../shared/world.mjs";
const neutral = { axis: 0, jump: false, fire: false, run: false, down: false };
test("the browser single-player bundle runs with no network or Node APIs and matches the server", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mario-local-"));
  try {
    const file = path.join(directory, "runtime.js");
    await build({
      entryPoints: ["javascript/runtime.mjs"],
      outfile: file,
      bundle: true,
      format: "iife",
      globalName: "MarioRuntime",
      platform: "browser",
      target: "es2022",
    });
    let requests = 0;
    const context = {
      structuredClone,
      fetch: () => {
        requests++;
        throw Error("Single player must not fetch gameplay state");
      },
      WebSocket: class {
        constructor() {
          requests++;
          throw Error("Single player must not create a room");
        }
      },
    };
    runInNewContext(readFileSync(file, "utf8"), context, { timeout: 3000 });
    for (const stage of ["1-1", "2-2", "3-3", "4-4", "8-4"]) {
      const local = context.MarioRuntime.createLocalGame(stage, 1),
        world = createWorld(1, { stage });
      addPlayer(world, "local", 0);
      for (let tick = 0; tick < 480; tick++) {
        const command = {
          ...neutral,
          axis: tick % 120 < 80 ? 1 : -1,
          run: true,
          jump: tick % 50 < 20,
          down: tick % 90 > 80,
        };
        const actual = local.step(command);
        stepWorld(world, new Map([["local", command]]));
        assert.deepEqual(
          JSON.parse(JSON.stringify(actual)),
          JSON.parse(JSON.stringify(snapshot(world))),
          `${stage} frame ${tick}`,
        );
      }
    }
    assert.equal(requests, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
