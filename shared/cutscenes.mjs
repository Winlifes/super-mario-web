import { emit } from "./events.mjs";
import { setPlayerForm } from "./motion.mjs";
import { TIMING } from "./rules.mjs";
const DT = 1 / 60;
const score = (w, value, p) => {
  w.score += value;
  emit(w, "score", p.x, p.y, p.id, value, p.zone);
};
function gather(w, p) {
  const feet = p.y + p.h;
  for (const q of w.players.values()) {
    q.vx = q.vy = 0;
    q.transit = null;
    q.climbing = null;
    q.pose = "idle";
    q.crouch = false;
    q.h = q.form ? 32 : 16;
    if (q.alive) q.y = feet - q.h;
    if (q !== p && q.alive) {
      q.zone = p.zone;
      q.x = p.x - 18 * (q.slot + 1);
    }
  }
  w.bullets = [];
  w.flames = [];
  w.hammers = [];
}
const change = (w, phase) => {
  w.cutscene.phase = phase;
  w.cutscene.phaseAt = w.tick;
};
export function beginFlag(w, p) {
  if (w.phase !== "playing") return;
  const goal = w.level.zones[p.zone].goal;
  const height = goal.poleBottom - (p.y + p.h);
  const value =
    height < 16
      ? 100
      : height < 56
        ? 400
        : height < 80
          ? 800
          : height < 124
            ? 2000
            : 5000;
  const time = Math.ceil(w.time),
    digit = time % 10;
  gather(w, p);
  w.phase = "cleared";
  w.cutscene = {
    type: "flag",
    phase: "slide",
    startedAt: w.tick,
    phaseAt: w.tick,
    playerId: p.id,
    zone: p.zone,
    goal,
    time,
    fireworks: [1, 3, 6].includes(digit) ? digit : 0,
    fired: 0,
    flagY: goal.y + 9,
    castleFlag: 0,
  };
  p.x = goal.x - p.w + 6;
  p.pose = "climb";
  score(w, value, p);
  emit(w, "flagpole", p.x, p.y, p.id, 0, p.zone);
}
export function beginCastle(w, p) {
  if (w.phase !== "playing" || w.bridgeOpened) return;
  const z = w.level.zones[p.zone];
  gather(w, p);
  w.phase = "bridge";
  w.bridgeOpened = true;
  w.cutscene = {
    type: "castle",
    phase: "bridge",
    startedAt: w.tick,
    phaseAt: w.tick,
    playerId: p.id,
    zone: p.zone,
    goal: z.goal,
    dialogLines: 0,
    removed: 0,
  };
  emit(w, "axe", p.x, p.y, p.id, 0, p.zone);
}
export function beginWarp(w, p, stage) {
  if (w.phase !== "playing") return;
  gather(w, p);
  w.phase = "warp";
  w.cutscene = {
    type: "warp",
    phase: "enter",
    startedAt: w.tick,
    phaseAt: w.tick,
    playerId: p.id,
    zone: p.zone,
    target: stage,
  };
  p.pose = "pipe";
  emit(w, "pipe", p.x, p.y, p.id, 0, p.zone);
}
export function stepCutscene(w, advance, move) {
  const c = w.cutscene;
  if (!c) return;
  const p =
    w.players.get(c.playerId) ||
    [...w.players.values()].find((p) => p.connected && p.alive);
  if (!p) return;
  c.playerId = p.id;
  const elapsed = w.tick - c.phaseAt,
    age = w.tick - c.startedAt;
  const members = [...w.players.values()].filter((q) => q.alive);
  if (c.type === "warp") {
    for (const q of members) {
      q.y += 0.5;
      q.pose = "pipe";
    }
    if (age >= 64) advance(c.target);
    return;
  }
  if (c.type === "flag") {
    const g = c.goal;
    if (c.phase === "slide") {
      c.flagY = Math.min(g.poleBottom - 8, c.flagY + 2);
      for (const q of members) {
        q.x = g.x - q.w + 6 - (q === p ? 0 : (q.slot + 1) * 16);
        q.y = Math.min(g.poleBottom - q.h, q.y + 2);
        q.pose = "climb";
      }
      if (
        members.every((q) => q.y + q.h >= g.poleBottom) &&
        c.flagY >= g.poleBottom - 8
      )
        change(w, "salute");
    } else if (c.phase === "salute") {
      if (elapsed >= 21) {
        for (const q of members) {
          q.x = g.x + 9 + (q === p ? 0 : (q.slot + 1) * 3);
          q.facing = -1;
        }
        change(w, "off-pole");
      }
    } else if (c.phase === "off-pole") {
      if (elapsed >= 14) {
        change(w, "walk");
        emit(w, "stageclear", p.x, p.y, p.id, 0, p.zone);
        for (const q of members) q.facing = 1;
      }
    } else if (c.phase === "walk") {
      for (const q of members) {
        if (q.pose === "hidden") continue;
        q.pose = "walk";
        q.vx = 60;
        q.vy = Math.min(480, q.vy + 900 * DT);
        move(w, q, DT);
        if (q.x >= g.doorX) {
          q.x = g.doorX;
          q.vx = q.vy = 0;
          q.pose = "hidden";
        }
      }
      if (members.every((q) => q.pose === "hidden")) {
        w.time = c.time;
        change(w, "count");
      }
    } else if (c.phase === "count") {
      if (w.time > 0) {
        w.time = Math.max(0, w.time - 1);
        w.score += 50;
        if (elapsed % 4 === 0)
          emit(w, "count", g.doorX, g.groundY, p.id, 0, p.zone);
      } else change(w, "count-wait");
    } else if (c.phase === "count-wait") {
      if (elapsed >= 35) change(w, "fireworks");
    } else if (c.phase === "fireworks") {
      c.castleFlag = Math.min(1, elapsed / 28);
      if (c.fired < c.fireworks && elapsed >= (c.fired + 1) * 28) {
        const offsets = [
            [0, -48],
            [-8, -40],
            [8, -40],
            [-8, -32],
            [0, -48],
            [-8, -40],
          ],
          o = offsets[c.fired++];
        emit(
          w,
          "firework",
          g.doorX + o[0] * 2,
          g.groundY - 16 + o[1] * 2,
          p.id,
          0,
          p.zone,
        );
        w.score += 500;
      }
      if (elapsed >= Math.max(420, c.fireworks * 28 + 21)) {
        if (w.campaign) advance(g.nextStage);
        else {
          w.phase = "won";
          emit(w, "win", p.x, p.y, p.id, 0, p.zone);
        }
      }
    }
    return;
  }
  if (c.phase === "bridge") {
    const bridge = w.level.zones[c.zone].platforms
      .filter((t) => t.type === "bridge")
      .sort((a, b) => b.x - a.x);
    if (c.removed < bridge.length) {
      w.broken.add(bridge[c.removed++].id);
      if (c.removed % 4 === 0) emit(w, "break", p.x, p.y, p.id, 0, p.zone);
    }
    if (c.removed === bridge.length && !c.fallingAt) {
      c.fallingAt = w.tick;
      emit(w, "bridge", p.x, p.y, p.id, 0, p.zone);
    }
    if (c.fallingAt)
      for (const e of w.enemies)
        if (e.type === "bowser" && e.zone === c.zone && !e.dead) {
          e.vy += 450 * DT;
          e.y += e.vy * DT;
        }
    if (age >= 140) {
      change(w, "walk");
      w.phase = "rescue";
      emit(w, "worldclear", p.x, p.y, p.id, 0, p.zone);
      for (const q of members) {
        q.x = Math.max(q.x, w.level.zones[c.zone].axe.x + 12);
        q.pose = "walk";
        q.facing = 1;
      }
    }
  } else if (c.phase === "walk") {
    for (const q of members) {
      if (q.pose === "idle") continue;
      q.vx = 60;
      q.vy = Math.min(480, q.vy + 900 * DT);
      move(w, q, DT);
      if (q.x >= c.goal.x) {
        q.x = c.goal.x + (q === p ? 0 : 14 * (q.slot + 1));
        q.vx = q.vy = 0;
        q.pose = "idle";
      }
    }
    if (members.every((q) => q.pose === "idle")) {
      change(w, "dialog");
      if (c.goal.type === "peach") emit(w, "ending", p.x, p.y, p.id, 0, p.zone);
    }
  } else if (c.phase === "dialog") {
    const lines = c.goal.type === "peach" ? 3 : 2;
    c.dialogLines = Math.min(lines, Math.floor(elapsed / 140));
    if (elapsed >= 280 + lines * 140) {
      if (c.goal.type === "peach") {
        w.phase = "won";
        emit(w, "win", p.x, p.y, p.id, 0, p.zone);
      } else advance(c.goal.nextStage);
    }
  }
}
// Pipe transport is per-player: teammates may remain in a bonus area until a team cutscene starts.
export function startTransit(w, p, target, direction = "down") {
  const to = w.level.locations?.[target];
  if (!to) return false;
  p.transit = {
    target,
    direction,
    phase: "enter",
    at: w.tick,
    fromX: p.x,
    fromY: p.y,
  };
  p.vx = p.vy = 0;
  p.pose = "pipe";
  p.ground = false;
  p.riding = null;
  p.climbing = null;
  emit(w, "pipe", p.x, p.y, p.id, 0, p.zone);
  return true;
}
export function travelTo(w, p, target, emerge = true) {
  const to = w.level.locations[target];
  if (!to) return;
  p.zone = to.zone;
  p.x = to.x;
  p.y = to.entry === "Normal" ? 16 : to.y;
  p.h = 16;
  setPlayerForm(w, p, p.form);
  p.vx = p.vy = 0;
  p.ground = false;
  p.riding = null;
  p.climbing = null;
  p.jumping = false;
  p.jumpLevel = 0;
  p.springUntil = 0;
  p.portalAt = w.tick + TIMING.portalCooldown;
  p.invincibleUntil = w.tick + TIMING.portalGrace;
  p.autoEntrance = false;
  if (emerge && to.entry === "PipeVertical") {
    const targetY = p.y;
    p.y = to.pipeY ?? targetY + p.h;
    p.pose = "pipe";
    p.transit = { phase: "emerge", at: w.tick, targetY };
    emit(w, "pipe", p.x, p.y, p.id, 0, p.zone);
  } else if (to.entry === "Vine") {
    p.x = 58;
    p.y = 224;
    p.pose = "climb";
    p.transit = { phase: "vine", at: w.tick };
  } else {
    p.transit = null;
    p.pose = "idle";
  }
}
export function stepTransit(w, p) {
  const t = p.transit;
  if (!t) return false;
  if (t.phase === "enter") {
    if (t.direction === "right") p.x = t.fromX + (w.tick - t.at) * 0.5;
    else p.y = t.fromY + (w.tick - t.at) * 0.5;
    if (w.tick - t.at >= Math.max(32, p.h * 2)) travelTo(w, p, t.target);
  } else if (t.phase === "emerge") {
    p.y = Math.max(t.targetY, p.y - 0.5);
    if (p.y <= t.targetY) {
      p.transit = null;
      p.pose = "idle";
    }
  } else if (t.phase === "vine") {
    p.y = Math.max(192 - p.h, p.y - 0.5);
    if (w.tick - t.at >= 145) {
      p.transit = null;
      p.pose = "idle";
      p.vx = 45;
      p.vy = -60;
      p.x += 16;
    }
  }
  return true;
}
