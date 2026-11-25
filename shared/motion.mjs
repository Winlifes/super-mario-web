// The same 60 Hz kinematics and tile collisions run locally, in prediction and on the server.
export const DT = 1 / 60;
const SMALL_HEIGHT = 16,
  STANDING_HEIGHT = 32,
  CROUCH_HEIGHT = 22;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const zoneOf = (w, b) => w.level.zones[b.zone || 0];
export function solids(w, b, up = false) {
  return zoneOf(w, b).platforms.filter(
    (t) =>
      !w.broken.has(t.id) &&
      (!t.hidden || w.used.has(t.id) || up) &&
      t.x < b.x + b.w + 20 &&
      t.x + t.w > b.x - 20,
  );
}
export function moveBody(w, b, dt, onCeiling = null) {
  const x0 = b.x,
    y0 = b.y,
    EPS = 0.001;
  let wall = false;
  b.x += b.vx * dt;
  for (const t of solids(w, b)) {
    if (!overlap(b, t)) continue;
    // Crossings use the previous edge: a corner touched while rising must not teleport above a tile.
    if (b.vx > 0 && x0 + b.w <= t.x + EPS) {
      b.x = Math.min(b.x, t.x - b.w);
      wall = true;
    } else if (b.vx < 0 && x0 >= t.x + t.w - EPS) {
      b.x = Math.max(b.x, t.x + t.w);
      wall = true;
    }
  }
  if (wall) b.vx = -b.vx;
  const previousBottom = y0 + b.h;
  b.ground = false;
  b.riding = null;
  b.y += b.vy * dt;
  for (const t of solids(w, b, Boolean(onCeiling && b.vy < 0))) {
    if (!overlap(b, t)) continue;
    if (b.vy > 0 && previousBottom <= t.y + EPS) {
      b.y = Math.min(b.y, t.y - b.h);
      b.ground = true;
    } else if (b.vy < 0 && y0 >= t.y + t.h - EPS) {
      b.y = Math.max(b.y, t.y + t.h);
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
function resizePlayer(w, p, height) {
  if (p.h === height) return true;
  const body = { ...p, y: p.y + p.h - height, h: height };
  if (height > p.h && solids(w, body).some((tile) => overlap(body, tile)))
    return false;
  p.y = body.y;
  p.h = height;
  return true;
}
export function setPlayerForm(w, p, form) {
  p.form = form;
  if (form) {
    if (!resizePlayer(w, p, STANDING_HEIGHT)) resizePlayer(w, p, CROUCH_HEIGHT);
  } else resizePlayer(w, p, SMALL_HEIGHT);
  p.crouch = Boolean(form && p.h < STANDING_HEIGHT);
}
// Pinned source: settings/math.js decreasePlayerRunningXvel. Source velocity *30 = px/s.
export function stepHorizontal(p, input, water = false, crawl = false) {
  let velocity = p.vx / 30,
    deceleration;
  if (input.axis && (!p.crouch || crawl)) {
    velocity =
      (velocity +
        input.axis * 0.098 * (1 + Number(input.run && !water && !crawl))) *
      0.98;
    deceleration = 0.0007;
  } else {
    velocity *= 0.98;
    deceleration = 0.035;
  }
  velocity =
    velocity > deceleration
      ? velocity - deceleration
      : velocity < -deceleration
        ? velocity + deceleration
        : 0;
  const limit = crawl ? 2.1 : 5.4;
  p.vx = clamp(velocity, -limit, limit) * 30;
  p.skidding = Boolean(input.axis && !p.crouch && p.vx * input.axis < 0);
  if ((p.ground || water) && Math.abs(p.vx) > 4.2) p.facing = Math.sign(p.vx);
}
export function stepPlayerMotion(w, p, input, events = {}) {
  const water = !!zoneOf(w, p).underwater;
  const carrying = w.movers.find((m) => m.id === p.riding);
  if (carrying) {
    p.x += carrying.dx;
    p.y += carrying.dy;
  }
  const wantsCrouch = Boolean(p.form && input.down && p.ground && !water);
  if (p.form) {
    resizePlayer(w, p, wantsCrouch ? CROUCH_HEIGHT : STANDING_HEIGHT);
    p.crouch = p.h < STANDING_HEIGHT;
  }
  stepHorizontal(p, input, water, p.crouch && !wantsCrouch);
  if (input.jump && !p.lastJump && (p.ground || water)) {
    p.vy = water ? -115 : -864 * DT;
    p.jumpLevel = 0;
    p.jumping = !water;
    p.jumpAt = w.tick;
    events.jump?.();
  }
  if (!input.jump) p.jumping = false;
  p.vy = Math.min(water ? 72 : 240, p.vy + (water ? 900 / 2.8 : 864) * DT);
  if (!water && input.jump && p.jumping && p.vy <= 0) {
    p.jumpLevel++;
    const exponent = 1.056 - (p.vx / 30) * 0.0014;
    p.vy = Math.max(-420, p.vy - 120 / Math.pow(p.jumpLevel, exponent));
  }
  if (
    moveBody(w, p, DT, (t) => {
      events.ceiling?.(t);
      p.jumping = false;
    })
  )
    p.vx = 0;
  if (water) p.y = Math.max(32, p.y);
  if (p.ground) {
    const spring = zoneOf(w, p).springs?.find(
      (t) =>
        p.x + p.w > t.x && p.x < t.x + t.w && Math.abs(p.y + p.h - t.y) < 2,
    );
    if (spring && !p.springUntil) {
      p.springUntil = w.tick + 7;
      p.springId = spring.id;
    }
    if (spring && w.tick >= p.springUntil) {
      p.vy = input.jump ? -450 : -340;
      p.ground = false;
      p.springUntil = 0;
      events.jump?.();
    }
    if (!spring) p.springUntil = 0;
  }
  p.x = clamp(p.x, 0, zoneOf(w, p).width - p.w);
  if (p.ground) {
    p.stompCombo = 0;
    p.jumping = false;
    p.jumpLevel = 0;
  }
}
export function playerRow(p, tick) {
  const round = (n) => Math.round(n * 10) / 10;
  return [
    p.id,
    round(p.x),
    round(p.y),
    round(p.vx),
    round(p.vy),
    p.form,
    p.facing,
    +p.alive,
    +(tick < p.invincibleUntil),
    p.lives,
    +p.connected,
    p.zone,
    +(tick < p.starUntil),
    +p.crouch,
    p.pose || "idle",
    !p.alive && p.deathAt ? Math.max(0, tick - p.deathAt) : -1,
    p.h,
    +p.skidding,
  ];
}
