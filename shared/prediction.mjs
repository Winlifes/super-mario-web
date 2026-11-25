import { stepPlayerMotion, playerRow, DT } from "./motion.mjs";
import { movePlatforms } from "./world.mjs";
export const INPUT_PROTOCOL = 2;
export class PlayerPredictor {
  constructor(level, id) {
    this.level = level;
    this.id = id;
    this.pending = [];
    this.effects = [];
    this.player = null;
    this.environment = null;
    this.offset = { x: 0, y: 0 };
    this.lastTick = -1;
    this.active = false;
  }
  reconcile(state, now = 0) {
    const prediction = state.prediction;
    if (
      !prediction ||
      prediction.protocol !== INPUT_PROTOCOL ||
      state.tick < this.lastTick
    ) {
      return;
    }
    this.lastTick = state.tick;
    this.receivedAt = now;
    const old = this.player ? { ...this.player } : null;
    this.pending = this.pending.filter((c) => c.seq > prediction.ack);
    const p = {
      ...prediction.player,
      transit: prediction.player.transit
        ? { ...prediction.player.transit }
        : null,
    };
    this.player = p;
    this.environment = {
      level: this.level,
      tick: state.tick,
      movers: prediction.movers.map((m) => ({ ...m })),
      used: new Set(state.used),
      broken: new Set(state.broken),
      players: new Map([[this.id, p]]),
      events: [],
      eventId: 0,
      score: state.score,
    };
    this.active =
      state.phase === "playing" &&
      p.alive &&
      p.connected &&
      !p.transit &&
      !p.climbing &&
      !p.autoEntrance;
    // Area changes, death, form changes and cutscenes are authoritative boundaries.
    if (
      (old &&
        (old.zone !== p.zone ||
          old.alive !== p.alive ||
          old.form !== p.form ||
          p.transit ||
          p.climbing)) ||
      !this.active
    )
      this.pending = [];
    if (this.active) for (const command of this.pending) this.simulate(command);
    const smooth =
      old &&
      this.active &&
      old.zone === p.zone &&
      old.alive === p.alive &&
      Math.hypot(old.x - p.x, old.y - p.y) < 48;
    this.offset = smooth ? { x: old.x - p.x, y: old.y - p.y } : { x: 0, y: 0 };
  }
  simulate(command, replay = true) {
    const w = this.environment,
      p = this.player;
    w.tick++;
    movePlatforms(w);
    stepPlayerMotion(w, p, command, {
      jump: () => {
        if (!replay) this.effects.push({ type: "jump", seq: command.seq });
      },
    });
    p.lastJump = command.jump;
    p.lastFire = command.fire;
  }
  step(command, now = 0) {
    // Bound speculative time under a stalled connection. Never simulate pickups, deaths or level changes here.
    if (
      !this.active ||
      !this.environment ||
      now - this.receivedAt > 300 ||
      this.pending.length >= 24
    )
      return false;
    this.pending.push({ ...command });
    this.simulate(command, false);
    return true;
  }
  row(now = 0) {
    if (!this.player || !this.environment || !this.active) return null;
    const row = playerRow(this.player, this.environment.tick),
      decay = Math.exp(-Math.max(0, now - (this.drawAt ?? now)) / 45);
    this.offset.x *= decay;
    this.offset.y *= decay;
    this.drawAt = now;
    row[1] += this.offset.x;
    row[2] += this.offset.y;
    return row;
  }
}
// Versioned commands are consumed at most once per server tick. Client timing never advances server time.
export function acceptInputFrames(player, frames) {
  if (!Array.isArray(frames) || !frames.length || frames.length > 6)
    return false;
  let seq = player.lastSeq;
  for (const f of frames) {
    if (
      !f ||
      !Number.isSafeInteger(f.seq) ||
      f.seq <= seq ||
      ![-1, 0, 1].includes(f.axis) ||
      !["jump", "fire", "run", "down"].every((k) => typeof f[k] === "boolean")
    )
      return false;
    seq = f.seq;
  }
  for (const frame of frames)
    player.inputQueue.push({
      seq: frame.seq,
      axis: frame.axis,
      jump: frame.jump,
      run: frame.run,
      fire: frame.fire,
      down: frame.down,
    });
  if (player.inputQueue.length > 24)
    player.inputQueue.splice(0, player.inputQueue.length - 24);
  player.lastSeq = seq;
  return true;
}
export function consumeInputFrame(player, now) {
  if (now - player.inputAt >= 400) {
    player.inputQueue = [];
    player.appliedSeq = player.lastSeq;
    player.input = {
      axis: 0,
      jump: false,
      run: false,
      fire: false,
      down: false,
    };
    return player.input;
  }
  const frame = player.inputQueue.shift();
  if (frame) {
    player.input = frame;
    player.appliedSeq = frame.seq;
  }
  return player.input;
}
