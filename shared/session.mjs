import * as world from "./world.mjs";
import { TIMING } from "./rules.mjs";

class TurnSession {
  constructor(seed, options) {
    this.mode = "turns";
    this.seed = seed;
    this.options = options;
    this.players = new Map();
    this.runs = new Map();
    this.activeId = null;
    this.world = world.createWorld(seed, options);
    this.revision = 1;
    this.deathTicks = 0;
    this.introTicks = 0;
    this.reason = "start";
    this.finished = false;
    this.finalPhase = "lost";
  }
  get level() {
    return this.world.level;
  }
  get movers() {
    return this.world.movers;
  }
  get tick() {
    return this.world.tick;
  }
  get phase() {
    if (this.finished) return this.finalPhase;
    if (!this.players.get(this.activeId)?.connected) return "waiting";
    if (this.deathTicks || this.introTicks) return "turn";
    return this.world.phase;
  }
  addPlayer(id, slot) {
    if (this.players.size >= 2 || this.players.has(id)) return null;
    const run = world.createWorld(this.seed, this.options);
    const player = world.addPlayer(run, id, 0);
    this.players.set(id, player);
    this.runs.set(id, { world: run, slot });
    if (!this.activeId) {
      this.activeId = id;
      this.world = run;
    }
    return player;
  }
  nextTurn(reason) {
    const entries = [...this.runs.entries()]
      .filter(([id]) => this.players.has(id))
      .sort((a, b) => a[1].slot - b[1].slot);
    const at = entries.findIndex(([id]) => id === this.activeId);
    const rotated = [...entries.slice(at + 1), ...entries.slice(0, at + 1)];
    const eligible = rotated.filter(
      ([id, run]) =>
        this.players.get(id).lives > 0 && run.world.phase !== "won",
    );
    const next =
      eligible.find(([id]) => this.players.get(id).connected) || eligible[0];
    if (!next) {
      this.finished = true;
      this.finalPhase = entries.some(([, run]) => run.world.phase === "won")
        ? "won"
        : "lost";
      return;
    }
    this.activeId = next[0];
    this.world = next[1].world;
    this.world.events = [];
    this.revision++;
    this.deathTicks = 0;
    this.introTicks = TIMING.turnIntro;
    this.reason = reason;
  }
  step(inputs) {
    if (this.finished) return;
    if (!this.players.has(this.activeId)) this.nextTurn("left");
    if (this.finished || !this.players.get(this.activeId)?.connected) return;
    if (this.introTicks) {
      this.introTicks--;
      return;
    }
    if (this.deathTicks) {
      world.stepWorld(this.world);
      if (--this.deathTicks === 0) this.nextTurn("death");
      return;
    }
    const player = this.players.get(this.activeId);
    const alive = player.alive;
    const revision = this.world.revision;
    world.stepWorld(
      this.world,
      new Map([[this.activeId, inputs.get(this.activeId)]]),
    );
    if (alive && !player.alive) {
      this.deathTicks = TIMING.respawn;
      this.reason = "death";
    } else if (this.world.phase === "won") {
      const continued = world.startNextCycle(this.world);
      this.nextTurn(continued ? "cycle" : "complete");
    } else if (this.world.revision !== revision) this.nextTurn("clear");
  }
  snapshot() {
    const state = world.snapshot(this.world);
    return {
      ...state,
      revision: this.revision,
      phase: this.phase,
      countdown: Math.ceil(
        (this.deathTicks || this.introTicks || this.world.countdown) / 60,
      ),
      activePlayerId: this.activeId,
      turnReason: this.reason,
      turnPhase: this.deathTicks ? "death" : "intro",
      standings: [...this.runs.entries()]
        .filter(([id]) => this.players.has(id))
        .map(([id, run]) => ({
          id,
          slot: run.slot,
          stage: run.world.level.stage,
          cycle: run.world.cycle,
          score: run.world.score,
          coins: run.world.coins,
          lives: this.players.get(id).lives,
          connected: this.players.get(id).connected,
        })),
    };
  }
}

export function createWorld(seed = 1, options = {}) {
  return options.mode === "turns"
    ? new TurnSession(seed, options)
    : world.createWorld(seed, options);
}
export function addPlayer(game, id, slot) {
  return game instanceof TurnSession
    ? game.addPlayer(id, slot)
    : world.addPlayer(game, id, slot);
}
export function stepWorld(game, inputs = new Map()) {
  if (game instanceof TurnSession) game.step(inputs);
  else world.stepWorld(game, inputs);
}
export function snapshot(game) {
  return game instanceof TurnSession ? game.snapshot() : world.snapshot(game);
}
export function startNextCycle(game) {
  return game instanceof TurnSession ? false : world.startNextCycle(game);
}
export function removePlayer(game, id) {
  game.players.delete(id);
  if (game instanceof TurnSession) game.runs.delete(id);
}
