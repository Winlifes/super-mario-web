import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createWorld,
  addPlayer,
  stepWorld,
  snapshot,
} from "../server/world.mjs";
import assert from "node:assert/strict";
const samples = [
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
  ],
  results = [];
for (const stage of samples) {
  const data = readFileSync(`docs/input-route-${stage}.json`),
    replay = JSON.parse(data),
    w = createWorld(1, { stage }),
    p = addPlayer(w, "route", 0),
    zones = [0],
    timeline = [],
    seen = new Set();
  while (w.phase === "countdown") stepWorld(w);
  for (const command of replay.route)
    for (let i = 0; i < command.ticks; i++) {
      stepWorld(w, new Map([["route", command]]));
      if (zones.at(-1) !== p.zone) zones.push(p.zone);
    }
  assert.equal(p.lives, 3);
  assert.equal(w.phase, stage.endsWith("-4") ? "bridge" : "cleared");
  assert.equal(w.score, replay.score);
  const revision = w.revision,
    endingTick = w.tick;
  for (
    let i = 0;
    i < 2400 && w.revision === revision && w.phase !== "won";
    i++
  ) {
    const key = `${w.phase}:${w.cutscene?.phase}`;
    if (!seen.has(key)) {
      seen.add(key);
      const state = snapshot(w);
      timeline.push({
        tick: w.tick,
        phase: w.phase,
        routine: w.cutscene?.phase,
        score: w.score,
        time: state.time,
        dialogLines: w.cutscene?.dialogLines || 0,
        removedBridgeSegments: w.cutscene?.removed || 0,
      });
    }
    stepWorld(w);
  }
  assert.equal(w.phase, stage === "8-4" ? "won" : "countdown");
  assert.equal(p.lives, 3);
  results.push({
    stage,
    seed: 1,
    normalSpawn: true,
    inputsOnly: true,
    startingLives: 3,
    endingLives: 3,
    routeSha256: createHash("sha256").update(data).digest("hex"),
    zoneOrder: zones,
    endingTick,
    finalStage: w.level.stage,
    finalPhase: w.phase,
    finalScore: w.score,
    cutsceneFrames: w.tick - endingTick,
    timeline,
  });
}
const proof = {
  recordedAt: new Date().toISOString(),
  sourceRevision: "dc7db1fdea151684d78425bd1152ff680c7047d6",
  stages: 32,
  normalInputReplays: results,
  fixtureCoverage:
    "All 32 endings, source transport graph, firework scoring, pipe/vine/warp routes, swimming, both branching mazes, scale carrying and new enemies are checked separately in tests. Fixture coverage is not claimed as natural completion of 32 courses.",
  physics:
    "60 Hz server port; jump acceleration and run cap now use the pinned source formula/values. Collision handling, cooperative life/checkpoint rules, clock and network interpolation are browser-port adaptations; no claim of ROM frame equivalence.",
};
writeFileSync(
  process.argv[2] || "docs/verification-campaign-2026-11-24.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    normalInputReplays: results.length,
    allPassed: true,
    finalRescue: results.at(-1).finalPhase,
  }),
);
