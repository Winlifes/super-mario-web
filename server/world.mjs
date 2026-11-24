import { makeLevel, stages } from "../shared/level.mjs";
const DT = 1 / 60,
  GRAVITY = 900;
const neutral = Object.freeze({
  axis: 0,
  jump: false,
  fire: false,
  run: false,
  down: false,
});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const round = (n) => Math.round(n * 10) / 10;
const zoneOf = (w, b) => w.level.zones[b.zone || 0];
const comboPoints = [100, 200, 400, 500, 800, 1000, 2000, 4000, 8000];

function installStage(w, stage) {
  w.level = makeLevel(w.seed, stage);
  w.events = [];
  w.revision++;
  w.time = w.level.time || 300;
  w.enemies = w.level.zones.flatMap((z) =>
    z.enemies.map((e) => ({
      ...e,
      zone: z.zone || 0,
      vy: 0,
      w: e.type === "bowser" ? 30 : 14,
      h:
        e.type === "koopa"
          ? 24
          : e.type === "bowser"
            ? 32
            : e.type === "piranha"
              ? 24
              : 14,
      dead: 0,
      hits: 0,
      homeX: e.x,
      homeY: e.y,
      state: "walk",
      combo: 0,
      owner: "",
      wakeAt: 0,
      active: false,
    })),
  );
  w.movers = w.level.zones.flatMap((z) =>
    z.movers.map((m) => ({ ...m, dx: 0, dy: 0 })),
  );
  w.items = [];
  w.bullets = [];
  w.flames = [];
  w.used = new Set();
  w.broken = new Set();
  w.taken = new Set();
  w.blockHits = new Map();
  w.bridgeOpened = false;
  w.axeAt = 0;
  w.countdown = 150;
  w.phase = "countdown";
  for (const p of w.players.values()) {
    const s = w.level.zones[0].spawn;
    p.zone = 0;
    p.x = s.x + (stage === "1-4" ? p.slot * 2 : p.slot * 22);
    p.y = s.y;
    p.vx = p.vy = 0;
    p.ground = false;
    p.riding = null;
    p.checkpoint = p.x;
    p.checkpointY = s.y;
    p.checkpointZone = 0;
    p.alive = p.lives > 0;
    p.respawnAt = 0;
    p.lastJump = p.lastFire = false;
    p.starUntil = 0;
    p.crouch = false;
    p.h = p.form ? 32 : 16;
    p.y -= p.h - 16;
    p.invincibleUntil = w.tick + 180;
  }
}
export function createWorld(seed = 1, options = {}) {
  const w = {
    seed,
    tick: 0,
    revision: 0,
    stageIndex: Math.max(0, stages.indexOf(options.stage || "1-1")),
    campaign: options.stage !== "meadow",
    players: new Map(),
    score: 0,
    coins: 0,
    events: [],
    eventId: 0,
    entityId: 0,
  };
  installStage(w, options.stage || "1-1");
  return w;
}
export function addPlayer(w, id, slot) {
  const s = w.level.zones[0].spawn;
  const p = {
    id,
    slot,
    zone: 0,
    x: s.x + (w.level.stage === "1-4" ? slot * 2 : slot * 22),
    y: s.y,
    w: 14,
    h: 16,
    vx: 0,
    vy: 0,
    form: 0,
    facing: 1,
    ground: false,
    alive: true,
    connected: true,
    lives: 3,
    checkpoint: s.x,
    checkpointY: s.y,
    checkpointZone: 0,
    invincibleUntil: 0,
    starUntil: 0,
    respawnAt: 0,
    lastJump: false,
    lastFire: false,
    jumpAt: -1000,
    nextFire: 0,
    portalAt: 0,
    stompCombo: 0,
    crouch: false,
    riding: null,
  };
  w.players.set(id, p);
  return p;
}
export function emit(w, type, x, y, playerId = "", value = 0, zone = 0) {
  w.events.push({
    id: ++w.eventId,
    type,
    x: round(x),
    y: round(y),
    playerId,
    value,
    zone,
  });
  if (w.events.length > 32) w.events.shift();
}
function points(w, p, value, x, y) {
  w.score += value;
  emit(w, "score", x, y, p?.id || "", value, p?.zone || 0);
}
function life(w, p) {
  p.lives = Math.min(99, p.lives + 1);
  emit(w, "oneup", p.x, p.y, p.id, 0, p.zone);
}
function combo(w, p, index, x, y) {
  if (index >= comboPoints.length) life(w, p);
  else points(w, p, comboPoints[index], x, y);
}
function solids(w, b, up = false) {
  return zoneOf(w, b).platforms.filter(
    (t) =>
      !w.broken.has(t.id) &&
      (!t.hidden || w.used.has(t.id) || up) &&
      t.x < b.x + b.w + 20 &&
      t.x + t.w > b.x - 20,
  );
}
function move(w, b, dt, onCeiling = null) {
  let wall = false;
  b.x += b.vx * dt;
  for (const t of solids(w, b)) {
    if (!overlap(b, t)) continue;
    if (b.vx > 0) b.x = t.x - b.w;
    else if (b.vx < 0) b.x = t.x + t.w;
    else continue;
    wall = true;
  }
  if (wall) b.vx = -b.vx;
  const previousBottom = b.y + b.h;
  b.ground = false;
  b.riding = null;
  b.y += b.vy * dt;
  for (const t of solids(w, b, Boolean(onCeiling && b.vy < 0))) {
    if (!overlap(b, t)) continue;
    if (b.vy > 0) {
      b.y = t.y - b.h;
      b.ground = true;
    } else if (b.vy < 0) {
      b.y = t.y + t.h;
      if (onCeiling) onCeiling(t);
    } else continue;
    b.vy = 0;
  }
  for (const m of w.movers) {
    if (
      m.zone !== (b.zone || 0) ||
      b.vy < 0 ||
      previousBottom > m.y + Math.max(3, m.dy + 2)
    )
      continue;
    if (overlap(b, m)) {
      b.y = m.y - b.h;
      b.vy = 0;
      b.ground = true;
      b.riding = m.id;
    }
  }
  return wall;
}
function form(p, value) {
  const height = value ? 32 : 16;
  p.y += p.h - height;
  p.h = height;
  p.form = value;
  p.crouch = false;
}
function coin(w, p, x, y) {
  w.coins++;
  points(w, p, 200, x, y);
  if (w.coins % 100 === 0)
    for (const member of w.players.values()) life(w, member);
  emit(w, "coin", x, y, p.id, 0, p.zone);
}
function hitBlock(w, p, t) {
  if (w.used.has(t.id) || w.broken.has(t.id)) return;
  const last = w.blockHits.get(t.id);
  if (last?.tick === w.tick || w.tick - (last?.tick ?? -100) < 8) return;
  if (t.content) {
    const hit = {
      tick: w.tick,
      count: (last?.count || 0) + 1,
      until: last?.until || w.tick + 240,
    };
    w.blockHits.set(t.id, hit);
    if (t.content !== "multi" || hit.count >= 10 || w.tick >= hit.until)
      w.used.add(t.id);
    emit(w, "bump", t.x, t.y, p.id, 0, p.zone);
    if (t.content === "coin" || t.content === "multi")
      coin(w, p, t.x, t.y - 16);
    else {
      const type =
        t.content === "power" ? (p.form ? "flower" : "mushroom") : t.content;
      w.items.push({
        id: `i${w.entityId++}`,
        type,
        zone: p.zone,
        x: t.x,
        y: t.y - 16,
        w: 14,
        h: 16,
        vx: type === "flower" ? 0 : 42,
        vy: type === "star" ? -180 : 0,
      });
      emit(w, "appear", t.x, t.y, p.id, 0, p.zone);
    }
  } else if (t.type === "brick" && p.form) {
    w.broken.add(t.id);
    points(w, p, 50, t.x, t.y);
    emit(w, "break", t.x, t.y, p.id, 0, p.zone);
  } else emit(w, "bump", t.x, t.y, p.id, 0, p.zone);
  for (const e of w.enemies)
    if (
      !e.dead &&
      e.type !== "bowser" &&
      e.zone === p.zone &&
      e.x + e.w > t.x &&
      e.x < t.x + t.w &&
      Math.abs(e.y + e.h - t.y) < 6
    ) {
      e.dead = w.tick;
      points(w, p, 100, e.x, e.y);
    }
}
function loseLife(w, p) {
  if (!p.alive) return;
  p.lives--;
  p.alive = false;
  p.vx = p.vy = 0;
  p.respawnAt = p.lives > 0 ? w.tick + 120 : 0;
  p.starUntil = 0;
  emit(w, "die", p.x, p.y, p.id, 0, p.zone);
}
function hurt(w, p) {
  if (!p.alive || w.tick < p.invincibleUntil || w.tick < p.starUntil) return;
  if (p.form) {
    form(p, 0);
    p.invincibleUntil = w.tick + 150;
    emit(w, "hurt", p.x, p.y, p.id, 0, p.zone);
  } else loseLife(w, p);
}
function portal(w, p, input) {
  if (w.tick < p.portalAt) return;
  for (const tube of zoneOf(w, p).portals) {
    const down =
      tube.direction === "down" &&
      input.down &&
      p.ground &&
      Math.abs(p.y + p.h - tube.y) < 3 &&
      p.x + 7 > tube.x + 4 &&
      p.x + 7 < tube.x + tube.w - 4;
    const right =
      tube.direction === "right" &&
      input.axis === 1 &&
      p.x + p.w >= tube.x - 2 &&
      p.x < tube.x + 8 &&
      p.y + p.h > tube.y + 8 &&
      p.y < tube.y + tube.h;
    if (!down && !right) continue;
    const to = w.level.locations?.[tube.target];
    if (!to) continue;
    emit(w, "pipe", p.x, p.y, p.id, 0, p.zone);
    p.zone = to.zone;
    p.x = to.x;
    p.y = to.y - (p.form ? 16 : 0);
    p.vx = p.vy = 0;
    p.ground = false;
    p.riding = null;
    p.portalAt = w.tick + 60;
    p.invincibleUntil = w.tick + 60;
    p.checkpoint = p.x;
    p.checkpointY = p.y;
    p.checkpointZone = p.zone;
    return;
  }
}
function finish(w, p) {
  if (w.phase !== "playing") return;
  const z = zoneOf(w, p);
  const height = 208 - (p.y + p.h);
  const flag =
    z.goal?.type === "flag"
      ? height >= 144
        ? 5000
        : height >= 100
          ? 2000
          : height >= 64
            ? 800
            : height >= 24
              ? 400
              : 100
      : 0;
  points(w, p, flag + Math.ceil(w.time) * 50, p.x, p.y);
  w.phase = w.campaign && w.stageIndex < 3 ? "cleared" : "won";
  w.countdown = 180;
  emit(w, "win", p.x, p.y, p.id, 0, p.zone);
}
function movePlatforms(w) {
  for (const m of w.movers) {
    const x = m.x,
      y = m.y;
    if (m.mode === "loop") {
      m.y += m.speed * DT;
      if (m.y > 240) m.y = -16;
      if (m.y < -16) m.y = 240;
    } else {
      const axis = m.mode === "vertical" ? "y" : "x";
      m[axis] += m.speed * DT;
      if (m[axis] >= m.end) {
        m[axis] = m.end;
        m.speed = -Math.abs(m.speed);
      } else if (m[axis] <= m.begin) {
        m[axis] = m.begin;
        m.speed = Math.abs(m.speed);
      }
    }
    m.dx = m.x - x;
    m.dy = m.y - y;
  }
}
function kick(w, p, e) {
  e.state = "moving";
  e.vx = (p.x + p.w / 2 < e.x + e.w / 2 ? 1 : -1) * 220;
  e.owner = p.id;
  e.combo = 0;
  e.safeUntil = w.tick + 12;
  e.wakeAt = 0;
  points(w, p, 400, e.x, e.y);
  emit(w, "kick", e.x, e.y, p.id, 0, p.zone);
}
function enemyContact(w, e, p) {
  if (
    !p.alive ||
    !p.connected ||
    e.dead ||
    e.zone !== p.zone ||
    !overlap(p, e) ||
    w.tick < (e.safeUntil || 0)
  )
    return;
  if (w.tick < p.starUntil && e.type !== "bowser") {
    e.dead = w.tick;
    points(w, p, 200, e.x, e.y);
    return;
  }
  const stomp =
    p.vy > 5 && p.y + p.h - e.y < 14 && !["piranha", "bowser"].includes(e.type);
  if (e.type === "koopa" && e.state !== "walk") {
    if (e.state === "idle") {
      kick(w, p, e);
      if (stomp) p.vy = -205;
    } else if (stomp) {
      e.state = "idle";
      e.vx = 0;
      e.wakeAt = w.tick + 480;
      e.safeUntil = w.tick + 12;
      p.y = e.y - p.h;
      p.vy = -205;
      points(w, p, 100, e.x, e.y);
      emit(w, "stomp", e.x, e.y, p.id, 0, p.zone);
    } else hurt(w, p);
  } else if (stomp) {
    p.y = e.y - p.h;
    p.vy = -205;
    combo(w, p, p.stompCombo++, e.x, e.y);
    if (e.type === "koopa") {
      if (e.winged) {
        e.winged = false;
        e.floating = false;
      } else {
        e.state = "idle";
        e.y += e.h - 14;
        e.h = 14;
        e.vx = 0;
        e.wakeAt = w.tick + 480;
        e.safeUntil = w.tick + 12;
      }
    } else e.dead = w.tick;
    emit(w, "stomp", e.x, e.y, p.id, 0, p.zone);
  } else hurt(w, p);
}
function tickEnemies(w) {
  for (const e of w.enemies) {
    if (e.dead) continue;
    const nearby = [...w.players.values()].filter(
      (p) =>
        p.connected &&
        p.alive &&
        p.zone === e.zone &&
        Math.abs(p.x - e.x) < 640,
    );
    if (!e.active && !nearby.length) continue;
    e.active = true;
    if (e.type === "piranha") {
      const phase = (w.tick + Math.floor(e.homeX)) % 300;
      const near = nearby.some((p) => Math.abs(p.x - e.x) < 30);
      const rise =
        phase < 60
          ? phase / 60
          : phase < 150
            ? 1
            : phase < 210
              ? (210 - phase) / 60
              : 0;
      e.y = e.pipeY + 2 - (near && phase < 60 ? 0 : rise) * 26;
      e.hidden = e.y >= e.pipeY;
    } else {
      if (e.type === "bowser") {
        if (w.bridgeOpened) {
          e.y += 4;
          continue;
        }
        e.vx = (Math.sin(w.tick / 90) > 0 ? 1 : -1) * 16.8;
        if (e.ground && w.tick % 117 === 0) e.vy = -210;
        if (nearby.length && [280, 350, 490].some((n) => w.tick % n === 0)) {
          const target = nearby.sort(
            (a, b) => Math.abs(a.x - e.x) - Math.abs(b.x - e.x),
          )[0];
          w.flames.push({
            id: `b${w.entityId++}`,
            zone: e.zone,
            x: e.x - 20,
            y: e.y + 8,
            w: 24,
            h: 8,
            vx: target.x < e.x ? -76 : 76,
            until: w.tick + 480,
          });
          e.firingUntil = w.tick + 24;
        }
      } else if (e.type === "koopa") {
        if (e.state === "idle" && w.tick >= e.wakeAt) {
          e.state = "walk";
          e.y -= 10;
          e.h = 24;
          e.vx = -30;
        }
        if (e.winged && e.floating) {
          e.y = e.begin + ((e.end - e.begin) * (1 + Math.sin(w.tick / 90))) / 2;
          e.vy = 0;
          e.vx = 0;
        } else if (e.smart && e.ground && e.state === "walk") {
          const ahead = {
            ...e,
            x: e.vx < 0 ? e.x - 3 : e.x + e.w,
            y: e.y + e.h,
            w: 3,
            h: 4,
          };
          if (!solids(w, ahead).some((t) => overlap(ahead, t))) e.vx = -e.vx;
        }
      }
      if (!(e.winged && e.floating)) {
        e.vy = Math.min(480, e.vy + GRAVITY * DT);
        move(w, e, DT);
      }
      if (e.y > 264) e.dead = w.tick;
    }
    if (!e.hidden) for (const p of w.players.values()) enemyContact(w, e, p);
  }
  for (const shell of w.enemies) {
    if (shell.dead || shell.state !== "moving") continue;
    for (const e of w.enemies) {
      if (
        e === shell ||
        e.dead ||
        e.zone !== shell.zone ||
        e.type === "bowser" ||
        !overlap(shell, e)
      )
        continue;
      e.dead = w.tick;
      const owner = w.players.get(shell.owner);
      if (owner)
        combo(
          w,
          owner,
          Math.min(shell.combo++ + 2, comboPoints.length),
          e.x,
          e.y,
        );
      emit(w, "kick", e.x, e.y, shell.owner, 0, e.zone);
    }
  }
}
export function stepWorld(w, inputs = new Map()) {
  w.tick++;
  if (w.phase === "countdown") {
    if (--w.countdown <= 0) w.phase = "playing";
    return;
  }
  if (w.phase === "cleared") {
    if (--w.countdown <= 0) {
      w.stageIndex++;
      installStage(w, stages[w.stageIndex]);
    }
    return;
  }
  if (w.phase === "bridge") {
    for (const e of w.enemies) if (e.type === "bowser" && !e.dead) e.y += 3;
    if (--w.countdown <= 0) {
      w.phase = "playing";
      for (const p of w.players.values()) p.invincibleUntil = w.tick + 180;
    }
    return;
  }
  if (w.phase !== "playing") return;
  w.time = Math.max(0, w.time - DT);
  if (w.time <= 0) {
    w.phase = "lost";
    emit(w, "timeup", 0, 0);
    return;
  }
  movePlatforms(w);
  for (const p of w.players.values()) {
    if (!p.alive) {
      if (p.respawnAt && w.tick >= p.respawnAt && p.connected) {
        form(p, 0);
        p.zone = p.checkpointZone;
        p.x = p.checkpoint;
        p.y = p.checkpointY;
        p.vx = p.vy = 0;
        p.alive = true;
        p.respawnAt = 0;
        p.invincibleUntil = w.tick + 180;
        p.riding = null;
        emit(w, "respawn", p.x, p.y, p.id, 0, p.zone);
      }
      continue;
    }
    const input = p.connected ? inputs.get(p.id) || neutral : neutral;
    if (p.form) {
      const wants = Boolean(input.down && p.ground);
      if (wants && !p.crouch) {
        p.y += p.h - 16;
        p.h = 16;
        p.crouch = true;
      } else if (!wants && p.crouch) {
        const expanded = { ...p, y: p.y - 16, h: 32 };
        if (!solids(w, expanded).some((t) => overlap(expanded, t))) {
          p.y -= 16;
          p.h = 32;
          p.crouch = false;
        }
      }
    }
    const carrying = w.movers.find((m) => m.id === p.riding);
    if (carrying) {
      p.x += carrying.dx;
      p.y += carrying.dy;
    }
    const target = (p.crouch ? 0 : input.axis) * (input.run ? 148 : 105),
      acceleration = p.ground ? 700 : 430;
    p.vx += clamp(target - p.vx, -acceleration * DT, acceleration * DT);
    if (input.axis) p.facing = input.axis;
    if (input.jump && !p.lastJump && p.ground) {
      p.vy = -315;
      p.jumpAt = w.tick;
      emit(w, "jump", p.x, p.y, p.id, 0, p.zone);
    }
    p.vy = Math.min(
      480,
      p.vy +
        (input.jump && p.vy < 0 && w.tick - p.jumpAt < 15 ? 520 : GRAVITY) * DT,
    );
    if (move(w, p, DT, (t) => hitBlock(w, p, t))) p.vx = 0;
    p.x = clamp(p.x, 0, zoneOf(w, p).width - p.w);
    if (p.ground) p.stompCombo = 0;
    if (p.y > 264) loseLife(w, p);
    if (
      p.alive &&
      input.fire &&
      !p.lastFire &&
      p.form === 2 &&
      w.tick >= p.nextFire &&
      w.bullets.filter((b) => b.owner === p.id).length < 2
    ) {
      w.bullets.push({
        id: `f${w.entityId++}`,
        zone: p.zone,
        owner: p.id,
        x: p.x + 7,
        y: p.y + 12,
        w: 6,
        h: 6,
        vx: p.facing * 260,
        vy: 80,
        until: w.tick + 150,
      });
      p.nextFire = w.tick + 15;
      emit(w, "fire", p.x, p.y, p.id, 0, p.zone);
    }
    p.lastJump = input.jump;
    p.lastFire = input.fire;
    if (!p.alive) continue;
    const z = zoneOf(w, p);
    const checkpoint =
      w.level.stage === "1-1" && p.zone === 0
        ? { x: 1440, y: 192 }
        : w.level.stage === "1-2" && p.zone === 1
          ? { x: 1456, y: 192 }
          : w.level.stage === "1-3" && p.zone === 0
            ? { x: 1232, y: 80 }
            : null;
    if (checkpoint && p.x > checkpoint.x + 64 && p.checkpoint < checkpoint.x) {
      p.checkpoint = checkpoint.x;
      p.checkpointY = checkpoint.y;
      p.checkpointZone = p.zone;
      emit(w, "checkpoint", p.x, p.y, p.id, 0, p.zone);
    }
    for (const c of z.coins)
      if (
        !w.taken.has(c.id) &&
        overlap(p, { x: c.x - 6, y: c.y - 7, w: 12, h: 14 })
      ) {
        w.taken.add(c.id);
        coin(w, p, c.x, c.y);
      }
    portal(w, p, input);
    const current = zoneOf(w, p);
    for (const hazard of current.hazards) {
      if (hazard.type === "lava" && overlap(p, hazard)) loseLife(w, p);
      else if (hazard.type === "firebar") {
        for (let i = 1; i <= hazard.count; i++) {
          const angle = w.tick * 0.025 * hazard.speed,
            fire = {
              x: hazard.x + Math.cos(angle) * i * 8 - 3,
              y: hazard.y + Math.sin(angle) * i * 8 - 3,
              w: 6,
              h: 6,
            };
          if (overlap(p, fire)) hurt(w, p);
        }
      }
    }
    if (p.alive && current.axe && !w.bridgeOpened && overlap(p, current.axe)) {
      w.bridgeOpened = true;
      w.axeAt = w.tick;
      w.phase = "bridge";
      w.countdown = 120;
      for (const t of current.platforms)
        if (t.type === "bridge") w.broken.add(t.id);
      w.flames = [];
      emit(w, "bridge", p.x, p.y, p.id, 0, p.zone);
    }
    const g = current.goal;
    if (
      p.alive &&
      g &&
      p.x + p.w >= g.x &&
      p.y + p.h > 55 &&
      (g.type !== "toad" || w.bridgeOpened)
    )
      finish(w, p);
  }
  if (w.phase !== "playing") return;
  tickEnemies(w);
  for (const item of w.items) {
    if (item.type !== "flower") {
      item.vy = Math.min(480, item.vy + GRAVITY * DT);
      move(w, item, DT);
      if (item.type === "star" && item.ground) item.vy = -240;
    }
    for (const p of w.players.values())
      if (p.alive && !item.used && p.zone === item.zone && overlap(p, item)) {
        if (item.type === "oneup") life(w, p);
        else if (item.type === "star") p.starUntil = w.tick + 560;
        else form(p, item.type === "flower" ? 2 : Math.max(1, p.form));
        p.invincibleUntil = Math.max(p.invincibleUntil, w.tick + 45);
        item.used = true;
        if (item.type !== "oneup") points(w, p, 1000, item.x, item.y);
        emit(w, "powerup", item.x, item.y, p.id, 0, p.zone);
      }
  }
  w.items = w.items.filter((i) => !i.used && i.y < 264);
  for (const b of w.bullets) {
    b.vy = Math.min(400, b.vy + GRAVITY * DT);
    if (move(w, b, DT)) b.until = 0;
    if (b.ground) b.vy = -180;
    for (const e of w.enemies) {
      if (
        b.until <= w.tick ||
        e.dead ||
        e.hidden ||
        e.zone !== b.zone ||
        !overlap(b, e)
      )
        continue;
      b.until = 0;
      const p = w.players.get(b.owner);
      if (e.type === "bowser") {
        if (++e.hits >= 5) {
          e.dead = w.tick;
          if (p) points(w, p, 5000, e.x, e.y);
          emit(w, "boss-down", e.x, e.y, b.owner, 0, e.zone);
        }
      } else {
        e.dead = w.tick;
        if (p) points(w, p, 100, e.x, e.y);
        emit(w, "stomp", e.x, e.y, b.owner, 0, e.zone);
      }
    }
  }
  w.bullets = w.bullets.filter(
    (b) => b.until > w.tick && b.y < 240 && b.x > 0 && b.x < zoneOf(w, b).width,
  );
  for (const f of w.flames) {
    f.x += f.vx * DT;
    for (const p of w.players.values())
      if (p.zone === f.zone && overlap(p, f)) hurt(w, p);
  }
  w.flames = w.flames.filter(
    (f) => f.until > w.tick && f.x > 0 && f.x < zoneOf(w, f).width,
  );
  const members = [...w.players.values()].filter((p) => p.connected);
  if (members.length && members.every((p) => !p.alive && p.lives <= 0))
    w.phase = "lost";
}
export function snapshot(w) {
  return {
    type: "state",
    tick: w.tick,
    revision: w.revision,
    stage: w.level.stage,
    phase: w.phase,
    countdown: Math.ceil(w.countdown / 60),
    time: Math.ceil(w.time),
    score: w.score,
    coins: w.coins,
    bridgeOpened: w.bridgeOpened,
    players: [...w.players.values()].map((p) => [
      p.id,
      round(p.x),
      round(p.y),
      round(p.vx),
      round(p.vy),
      p.form,
      p.facing,
      +p.alive,
      +(w.tick < p.invincibleUntil),
      p.lives,
      +p.connected,
      p.zone,
      +(w.tick < p.starUntil),
      +p.crouch,
    ]),
    enemies: w.enemies
      .filter((e) => (!e.dead || w.tick - e.dead < 25) && !e.hidden)
      .map((e) => [
        e.id,
        round(e.x),
        round(e.y),
        round(e.vx),
        +!!e.dead,
        e.type,
        e.state,
        e.zone,
        +e.smart,
        +e.winged,
        e.hits,
        +(w.tick < e.firingUntil),
      ]),
    items: w.items.map((i) => [i.id, round(i.x), round(i.y), i.type, i.zone]),
    bullets: w.bullets.map((b) => [b.id, round(b.x), round(b.y), b.zone]),
    flames: w.flames.map((f) => [f.id, round(f.x), round(f.y), f.zone, f.vx]),
    movers: w.movers.map((m) => [m.id, round(m.x), round(m.y), m.zone]),
    used: [...w.used],
    broken: [...w.broken],
    taken: [...w.taken],
    events: w.events,
  };
}
