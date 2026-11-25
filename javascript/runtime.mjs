import {
  createWorld,
  addPlayer,
  stepWorld,
  snapshot,
} from "../shared/world.mjs";
import { PlayerPredictor, INPUT_PROTOCOL } from "../shared/prediction.mjs";
export { PlayerPredictor, INPUT_PROTOCOL };
export function createLocalGame(stage = "1-1", seed = 1) {
  const world = createWorld(seed, { stage });
  addPlayer(world, "local", 0);
  return {
    world,
    step(input) {
      stepWorld(world, new Map([["local", input]]));
      return snapshot(world);
    },
    snapshot() {
      return snapshot(world);
    },
    get level() {
      return world.level;
    },
  };
}
