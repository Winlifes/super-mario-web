import {
  createWorld,
  addPlayer,
  stepWorld,
  snapshot,
  startNextCycle,
} from "../shared/session.mjs";
import { PlayerPredictor, INPUT_PROTOCOL } from "../shared/prediction.mjs";
export { PlayerPredictor, INPUT_PROTOCOL };
export { TIMING } from "../shared/rules.mjs";
export function createLocalGame(stage = "1-1", seed = 1, mode = "solo") {
  const world = createWorld(seed, { stage, mode });
  addPlayer(world, "local", 0);
  if (mode === "turns") addPlayer(world, "local2", 1);
  return {
    world,
    step(input) {
      stepWorld(world, new Map([[world.activeId || "local", input]]));
      return snapshot(world);
    },
    nextCycle() {
      return startNextCycle(world);
    },
    snapshot() {
      return snapshot(world);
    },
    get level() {
      return world.level;
    },
  };
}
