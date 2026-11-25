import { makeLevel, stages } from "./level.mjs";
import { emit } from "./events.mjs";
import {
  beginFlag,
  beginCastle,
  beginWarp,
  stepCutscene,
  startTransit,
  stepTransit,
  travelTo,
} from "./cutscenes.mjs";
export { emit } from "./events.mjs";
import {
  solids,
  moveBody as move,
  stepPlayerMotion,
  playerRow,
} from "./motion.mjs";
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
      w: e.type === "bowser" ? 30 : e.type === "podoboo" ? 14 : 14,
      h: ["koopa", "hammerbro", "lakitu", "blooper", "piranha"].includes(e.type)
        ? 24
        : e.type === "bowser"
          ? 32
          : e.type === "piranha"
            ? 24
            : 14,
      dead: 0,
      hits: 0,
      activeAt: 0,
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
  w.cutscene = null;
  w.hammers = [];
  w.vines = [];
  w.stageTick = 0;
  w.triggerTicks = new Map();
  w.spawnFlags = new Map();
  w.axeAt = 0;
  w.countdown = 150;
  w.phase = "countdown";
  for (const p of w.players.values()) {
    const s = w.level.zones[0].spawn;
    p.zone = 0;
    p.x = s.x + (stage.endsWith("-4") ? p.slot * 2 : p.slot * 22);
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
    p.jumpLevel = 0;
    p.jumping = false;
    p.skidding = false;
    p.transit = null;
    p.climbing = null;
    p.pose = "idle";
    p.mazePassed = false;
    p.mazeSection = 0;
    p.mazeAt = 0;
    p.springUntil = 0;
    p.autoEntrance = w.level.entry === "Walking";
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
    randomState: seed >>> 0 || 1,
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
    x: s.x + (w.level.stage.endsWith("-4") ? slot * 2 : slot * 22),
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
    jumpLevel: 0,
    jumping: false,
    skidding: false,
    nextFire: 0,
    portalAt: 0,
    stompCombo: 0,
    crouch: false,
    riding: null,
    pose: "idle",
    transit: null,
    climbing: null,
    mazePassed: false,
    mazeAt: 0,
    springUntil: 0,
    autoEntrance: w.level.entry === "Walking",
  };
  w.players.set(id, p);
  return p;
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
    else if (t.content === "vine") {
      w.vines.push({
        id: `v${w.entityId++}`,
        zone: p.zone,
        x: t.x + 1,
        y: t.y,
        h: 0,
        bottom: t.y,
        target: t.transport,
      });
      emit(w, "vine", t.x, t.y, p.id, 0, p.zone);
    } else {
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
      e.deathKind = "flip";
      e.vy = -120;
      points(w, p, 100, e.x, e.y);
    }
}
function loseLife(w, p) {
  if (!p.alive) return;
  p.lives--;
  p.deathAt = w.tick;
  p.deathX = p.x;
  p.deathY = p.y;
  p.pose = "dead";
  p.transit = null;
  p.climbing = null;
  p.alive = false;
  p.vx = p.vy = 0;
  p.respawnAt = p.lives > 0 ? w.tick + 120 : 0;
  p.starUntil = 0;
  emit(w, "die", p.x, p.y, p.id, 0, p.zone);
}
function hurt(w, p) {
  if (
    !p.alive ||
    p.transit ||
    w.tick < p.invincibleUntil ||
    w.tick < p.starUntil
  )
    return;
  if (p.form) {
    form(p, 0);
    p.invincibleUntil = w.tick + 150;
    emit(w, "hurt", p.x, p.y, p.id, 0, p.zone);
  } else loseLife(w, p);
}
function advanceStage(w, stage) {
  const target = stages.includes(stage) ? stage : stages[w.stageIndex + 1];
  if (!target) {
    w.phase = "won";
    return;
  }
  w.stageIndex = stages.indexOf(target);
  installStage(w, target);
}
function portal(w, p, input) {
  if (w.tick < p.portalAt || p.transit) return;
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
    if (typeof tube.target === "object") {
      if (stages.includes(tube.target.map)) beginWarp(w, p, tube.target.map);
    } else startTransit(w, p, tube.target, tube.direction);
    return;
  }
}
function finish(w, p) {
  beginFlag(w, p);
}
export function movePlatforms(w) {
  const riders = (m) =>
    [...w.players.values()].filter((p) => p.alive && p.riding === m.id);
  const old = new Map(w.movers.map((m) => [m.id, [m.x, m.y]])),
    scales = new Set();
  for (const m of w.movers) {
    if (m.mode === "loop") {
      m.y += m.speed * DT;
      if (m.y > 240) m.y = -16;
      if (m.y < -16) m.y = 240;
    } else if (["horizontal", "vertical"].includes(m.mode)) {
      const axis = m.mode === "vertical" ? "y" : "x";
      m[axis] += m.speed * DT;
      if (m[axis] >= m.end) {
        m[axis] = m.end;
        m.speed = -Math.abs(m.speed);
      } else if (m[axis] <= m.begin) {
        m[axis] = m.begin;
        m.speed = Math.abs(m.speed);
      }
    } else if (m.mode === "transport") {
      if (riders(m).length) m.started = true;
      if (m.started) m.x += 1.5;
    } else if (m.mode === "falling" || m.mode === "freefall") {
      if (riders(m).length || m.mode === "freefall") {
        m.vy = Math.min(252, (m.vy || 0) + 450 * DT);
        m.y += m.vy * DT;
        if (m.vy >= 168) m.mode = "freefall";
      } else m.vy = 0;
    } else if (m.mode === "scale" && !scales.has(m.group)) {
      scales.add(m.group);
      const n = w.movers.find((n) => n.group === m.group && n !== m);
      if (!n) continue;
      const load = riders(m).length - riders(n).length;
      m.vy = load
        ? clamp((m.vy || 0) + load * 225 * DT, -180, 180)
        : (m.vy || 0) * 0.9;
      const delta = m.vy * DT;
      m.y += delta;
      n.y -= delta;
      m.tension += delta;
      n.tension -= delta;
      if (m.tension <= 0 || n.tension <= 0) {
        m.mode = n.mode = "freefall";
        m.vy = n.vy = 60;
        const owner = riders(m)[0] || riders(n)[0];
        if (owner) points(w, owner, 1000, m.x, m.y);
      }
    }
  }
  for (const m of w.movers) {
    const [x, y] = old.get(m.id);
    m.dx = m.x - x;
    m.dy = m.y - y;
  }
}
function random(w) {
  let n = w.randomState;
  n ^= n << 13;
  n ^= n >>> 17;
  n ^= n << 5;
  w.randomState = n >>> 0;
  return w.randomState / 4294967296;
}
function spawnEnemy(w, type, zone, x, y, extra = {}) {
  const e = {
    id: `spawn${w.entityId++}`,
    type,
    zone,
    x,
    y,
    w: 14,
    h: type === "blooper" ? 24 : 14,
    vx: 0,
    vy: 0,
    dead: 0,
    hits: 0,
    homeX: x,
    homeY: y,
    state: "walk",
    active: true,
    activeAt: w.tick,
    dynamic: true,
    until: w.tick + 900,
    ...extra,
  };
  w.enemies.push(e);
  return e;
}
function hammer(w, e, target) {
  const vx = target.x < e.x ? -72 : 72;
  w.hammers.push({
    id: `h${w.entityId++}`,
    zone: e.zone,
    x: e.x + 4,
    y: e.y - 4,
    w: 8,
    h: 8,
    vx,
    vy: -210,
    until: w.tick + 240,
  });
  e.firingUntil = w.tick + 14;
}
function triggers(w, p) {
  const z = zoneOf(w, p);
  for (const t of z.triggers || []) {
    if (t.type === "cannon") continue;
    if (!overlap(p, t)) continue;
    if (t.type === "maze-pass" || t.type === "maze-fail") {
      const pass = t.type === "maze-pass";
      if (p.mazeTrigger !== t.id) {
        p.mazePassed = pass;
        p.mazeTrigger = t.id;
        emit(w, pass ? "coin" : "maze-fail", p.x, p.y, p.id, 0, p.zone);
      }
    } else if (
      (t.type === "maze-next" || t.type === "maze-decide") &&
      w.tick > p.mazeAt
    ) {
      const target =
          t.type === "maze-next" ? t.target : p.mazePassed ? t.pass : t.fail,
        to = z.sections[target];
      if (to) {
        p.mazeSection = target;
        p.x = to.x + 1;
        p.mazeAt = w.tick + 18;
        p.mazeTrigger = null;
        if (t.type === "maze-decide") p.mazePassed = false;
      }
    } else if (t.type === "LakituStop") {
      for (const e of w.enemies)
        if (e.zone === p.zone && e.type === "lakitu") e.fleeing = true;
    } else if (t.type.endsWith("Start") || t.type.endsWith("Stop")) {
      const flag = t.type.startsWith("Cheeps") ? "cheeps" : "bills";
      w.spawnFlags.set(`${p.zone}:${flag}`, t.type.endsWith("Start"));
    }
  }
}
function spawners(w) {
  for (const z of w.level.zones) {
    const players = [...w.players.values()].filter(
      (p) => p.alive && p.connected && !p.transit && p.zone === z.zone,
    );
    if (!players.length) continue;
    const lead = players.reduce((a, b) => (a.x > b.x ? a : b));
    if (w.spawnFlags.get(`${z.zone}:cheeps`) && w.stageTick % 21 === 0) {
      const x = clamp(lead.x - 130 + random(w) * 320, 0, z.width - 16),
        vx = (x < lead.x ? 1 : -1) * random(w) * 168;
      spawnEnemy(w, "cheep", z.zone, x, 240, {
        vx,
        vy: -168,
        flying: true,
        red: true,
      });
    }
    if (w.spawnFlags.get(`${z.zone}:bills`) && w.stageTick % 210 === 0)
      spawnEnemy(
        w,
        "bill",
        z.zone,
        lead.x + 230,
        48 + Math.floor(random(w) * 5) * 24,
        { vx: -60 },
      );
    for (const t of z.triggers.filter((t) => t.type === "cannon")) {
      if (
        Math.abs(lead.x - t.x) > 640 ||
        players.some((p) => p.x + p.w > t.x - 16 && p.x < t.x + t.w + 16)
      )
        continue;
      if (w.tick - (w.triggerTicks.get(t.id) || 0) < t.frequency) continue;
      w.triggerTicks.set(t.id, w.tick);
      spawnEnemy(w, "bill", z.zone, t.x, t.y + 2, {
        vx: lead.x < t.x ? -60 : 60,
      });
      emit(w, "cannon", t.x, t.y, "", 0, z.zone);
    }
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
    p.transit ||
    e.zone !== p.zone ||
    !overlap(p, e) ||
    w.tick < (e.safeUntil || 0)
  )
    return;
  if (w.tick < p.starUntil && e.type !== "bowser") {
    e.dead = w.tick;
    e.deathKind = "flip";
    e.vy = -120;
    points(w, p, 200, e.x, e.y);
    return;
  }
  const stomp =
    p.vy > 5 &&
    p.y + p.h - e.y < 14 &&
    !zoneOf(w, p).underwater &&
    !["piranha", "bowser", "podoboo", "spiny", "spiny-egg"].includes(e.type);
  if (["koopa", "beetle"].includes(e.type) && e.state !== "walk") {
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
    if (["koopa", "beetle"].includes(e.type)) {
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
    } else {
      e.dead = w.tick;
      e.deathKind = "stomp";
    }
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
        !p.transit &&
        p.zone === e.zone &&
        Math.abs(p.x - e.x) < 640,
    );
    if (!e.active && !nearby.length) continue;
    if (!e.active) {
      e.active = true;
      e.activeAt = w.tick;
    }
    const age = w.tick - e.activeAt,
      target = nearby.sort(
        (a, b) => Math.abs(a.x - e.x) - Math.abs(b.x - e.x),
      )[0];
    if (e.type === "piranha") {
      const phase = (w.tick + Math.floor(e.homeX)) % 300,
        near = nearby.some((p) => Math.abs(p.x - e.x) < 30);
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
    } else if (e.type === "cheep") {
      if (e.flying) {
        if (e.y < 56) e.fallStarted = true;
        if (e.fallStarted) e.vy += (GRAVITY / 3.5) * DT;
        e.x += e.vx * DT;
        e.y += e.vy * DT;
      } else {
        e.vx = e.red ? -30 : -20;
        e.vy = e.vy || (e.red ? -5 : -3.75);
        e.x += e.vx * DT;
        e.y += e.vy * DT;
        if (e.y < 32) {
          e.y = 32;
          e.vy = Math.abs(e.vy);
        }
      }
    } else if (e.type === "blooper") {
      e.counter = (e.counter || 0) + 1;
      if (e.counter === 56) e.squeeze = true;
      if (e.counter >= 63 && (e.y > (target?.y ?? 160) || e.y + e.h > 182)) {
        e.counter = 0;
        e.squeeze = false;
      }
      if (e.y < 36) e.squeeze = true;
      e.vy = e.squeeze
        ? Math.max(21, Math.min(48, e.vy + 0.63))
        : Math.min(-21, Math.max(-48, e.vy - 1.05));
      e.y += e.vy * DT;
      if (!e.squeeze && target) {
        const dx = target.x - e.x;
        e.vx = clamp(e.vx + Math.sign(dx) * 3.75, -60, 60);
      } else e.vx *= 0.88;
      e.x += e.vx * DT;
    } else if (e.type === "podoboo") {
      if (age % 245 === 0) {
        e.jumping = true;
        e.vy = -210;
        e.falling = false;
      }
      if (e.jumping) {
        if (e.y <= 56) e.falling = true;
        if (e.falling) e.vy = Math.min(210, e.vy + 150 * DT);
        e.y += e.vy * DT;
        if (e.y >= e.homeY) {
          e.y = e.homeY;
          e.jumping = false;
          e.vy = 0;
        }
      }
      e.hidden = e.y >= 240;
    } else if (e.type === "bill") {
      e.x += e.vx * DT;
    } else if (e.type === "lakitu") {
      if (e.fleeing) {
        e.vx = -120;
        e.x += e.vx * DT;
      } else if (target) {
        const to = target.x + target.vx + Math.sin(Math.PI * age * 0.007) * 117;
        e.vx = clamp((to - e.x) * 2, -105, 105);
        e.x += e.vx * DT;
        if (age > 0 && age % 140 === 0) {
          spawnEnemy(w, "spiny-egg", e.zone, e.x, e.y + 12, {
            vx: (random(w) - 0.5) * 35,
            vy: -90,
          });
          e.firingUntil = w.tick + 14;
        }
      }
    } else {
      if (e.type === "bowser") {
        e.vx = (Math.sin(age / 90) > 0 ? 1 : -1) * 16.8;
        if (e.ground && age % 117 === 0) e.vy = -210;
        if (target && [280, 350, 490].some((n) => age > 0 && age % n === 0)) {
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
        if (
          e.throwing &&
          target &&
          age >= 84 &&
          (age - 84) % 210 < 77 &&
          (age - 84) % 11 === 0
        )
          hammer(w, e, target);
      } else if (e.type === "hammerbro") {
        e.vx = Math.cos(age * 0.007) * 53;
        e.facing = target && target.x < e.x ? -1 : 1;
        if (e.ground && age > 0 && age % 140 === 0) e.vy = -250;
        const burst = (age - 35) % 168;
        if (
          target &&
          age >= 35 &&
          burst < 98 &&
          burst % 14 === 0 &&
          burst !== 56
        )
          hammer(w, e, target);
      } else if (["koopa", "beetle"].includes(e.type)) {
        if (e.state === "idle" && w.tick >= e.wakeAt) {
          e.state = "walk";
          const height = e.type === "koopa" ? 24 : 16;
          e.y -= height - e.h;
          e.h = height;
          e.vx = -30;
        }
        if (e.winged && e.floating) {
          e.y = e.begin + ((e.end - e.begin) * (1 + Math.sin(w.tick / 90))) / 2;
          e.vy = e.vx = 0;
        } else if (e.winged && e.ground) e.vy = -235;
        else if (
          (e.smart || e.type === "beetle") &&
          e.ground &&
          e.state === "walk"
        ) {
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
        e.vy = Math.min(
          480,
          e.vy +
            (e.type === "hammerbro"
              ? GRAVITY / 2.1
              : e.type === "bowser" || e.winged
                ? GRAVITY / 2.8
                : GRAVITY) *
              DT,
        );
        if (e.type === "hammerbro" && e.vy < 0) {
          e.x += e.vx * DT;
          e.y += e.vy * DT;
        } else move(w, e, DT);
      }
      if (e.type === "spiny-egg" && e.ground) {
        e.type = "spiny";
        e.vx = target && target.x < e.x ? -30 : 30;
      }
    }
    if ((e.y > 300 && e.type !== "podoboo") || (e.dynamic && w.tick >= e.until))
      e.dead = w.tick;
    if (!e.hidden) for (const p of w.players.values()) enemyContact(w, e, p);
  }
  w.enemies = w.enemies.filter(
    (e) => !e.dynamic || !e.dead || w.tick - e.dead < 25,
  );
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
      e.deathKind = "flip";
      e.vy = -120;
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
  for (const e of w.enemies)
    if (e.dead && e.deathKind === "flip") {
      e.vy += GRAVITY * DT;
      e.y += e.vy * DT;
    }
  if (w.phase === "countdown") {
    if (--w.countdown <= 0) w.phase = "playing";
    return;
  }
  if (["cleared", "bridge", "rescue", "warp"].includes(w.phase)) {
    stepCutscene(w, (stage) => advanceStage(w, stage), move);
    return;
  }
  if (w.phase !== "playing") return;
  w.stageTick++;
  if (![...w.players.values()].some((p) => p.autoEntrance))
    w.time = Math.max(0, w.time - DT);
  if (w.time <= 0) {
    w.phase = "lost";
    emit(w, "timeup", 0, 0);
    return;
  }
  movePlatforms(w);
  for (const v of w.vines) {
    const top = v.y;
    v.y = Math.max(-64, v.y - 0.5);
    v.h = v.bottom - v.y;
    for (const p of w.players.values())
      if (p.climbing === v.id) p.y += v.y - top;
  }
  spawners(w);
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
        p.pose = "idle";
        p.transit = null;
        p.climbing = null;
        emit(w, "respawn", p.x, p.y, p.id, 0, p.zone);
      }
      continue;
    }
    if (stepTransit(w, p)) continue;
    const input = p.autoEntrance
      ? { ...neutral, axis: 1 }
      : p.connected
        ? inputs.get(p.id) || neutral
        : neutral;
    const water = zoneOf(w, p).underwater;
    if (p.climbing) {
      const v = w.vines.find((v) => v.id === p.climbing);
      if (!v || input.axis) {
        p.climbing = null;
        p.pose = "idle";
        p.vx = input.axis * 60;
      } else {
        p.pose = "climb";
        p.vx = p.vy = 0;
        if (input.jump) p.y -= 0.5;
        else if (input.down) p.y += 1;
        if (p.y > v.bottom) {
          p.climbing = null;
          p.pose = "idle";
        } else if (p.y + p.h < -8) {
          travelTo(w, p, v.target);
        }
        continue;
      }
    }
    if (input.jump && !p.ground)
      for (const v of w.vines)
        if (v.zone === p.zone && overlap(p, { ...v, w: 14 })) {
          p.climbing = v.id;
          p.pose = "climb";
          p.vx = p.vy = 0;
          break;
        }
    if (p.climbing) continue;
    p.pose = water ? "swim" : "idle";
    stepPlayerMotion(w, p, input, {
      jump: () => emit(w, "jump", p.x, p.y, p.id, 0, p.zone),
      ceiling: (t) => hitBlock(w, p, t),
    });
    if (p.y > 264) {
      const z = zoneOf(w, p);
      if (z.sky && Number.isInteger(z.exit)) {
        travelTo(w, p, z.exit, false);
        continue;
      } else loseLife(w, p);
    }
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
    for (const checkpoint of z.checkpoints || [])
      if (
        p.x > checkpoint.x + 64 &&
        (p.checkpointZone !== p.zone || p.checkpoint < checkpoint.x)
      ) {
        p.checkpoint = checkpoint.x;
        p.checkpointY = checkpoint.y;
        p.checkpointZone = p.zone;
        emit(w, "checkpoint", p.x, p.y, p.id, 0, p.zone);
      }
    triggers(w, p);
    for (const c of z.coins)
      if (
        !w.taken.has(c.id) &&
        overlap(p, { x: c.x - 6, y: c.y - 7, w: 12, h: 14 })
      ) {
        w.taken.add(c.id);
        coin(w, p, c.x, c.y);
      }
    portal(w, p, input);
    if (p.transit || w.phase !== "playing") continue;
    const current = zoneOf(w, p);
    for (const hazard of current.hazards) {
      if (
        ["lava", "water"].includes(hazard.type) &&
        !current.underwater &&
        overlap(p, {
          ...hazard,
          y: hazard.y + 12,
          h: Math.max(0, hazard.h - 12),
        })
      )
        loseLife(w, p);
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
      beginCastle(w, p);
    }
    const g = current.goal;
    if (
      p.alive &&
      g?.type === "flag" &&
      p.x + p.w >= g.x &&
      p.y + p.h > 55 &&
      w.phase === "playing"
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
        ["beetle", "bill", "podoboo"].includes(e.type) ||
        e.zone !== b.zone ||
        !overlap(b, e)
      )
        continue;
      b.until = 0;
      const p = w.players.get(b.owner);
      if (e.type === "bowser") {
        if (++e.hits >= 5) {
          e.dead = w.tick;
          e.deathKind = "flip";
          e.vy = -120;
          if (p) points(w, p, 5000, e.x, e.y);
          emit(w, "boss-down", e.x, e.y, b.owner, 0, e.zone);
        }
      } else {
        e.dead = w.tick;
        e.deathKind = "flip";
        e.vy = -120;
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
  for (const h of w.hammers) {
    h.x += h.vx * DT;
    h.vy += 450 * DT;
    h.y += h.vy * DT;
    for (const p of w.players.values())
      if (p.zone === h.zone && overlap(p, h)) hurt(w, p);
  }
  w.hammers = w.hammers.filter((h) => h.until > w.tick && h.y < 280);
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
    cutscene: w.cutscene,
    hammers: w.hammers.map((h) => [h.id, round(h.x), round(h.y), h.zone]),
    vines: w.vines.map((v) => [
      v.id,
      round(v.x),
      round(v.y),
      round(v.h),
      v.zone,
    ]),
    springs: [...w.players.values()]
      .filter((p) => p.springUntil > w.tick)
      .map((p) => [p.springId, (p.springUntil - w.tick) / 7]),
    players: [...w.players.values()].map((p) => playerRow(p, w.tick)),
    enemies: w.enemies
      .filter(
        (e) =>
          (!e.dead || w.tick - e.dead < (e.deathKind === "flip" ? 350 : 25)) &&
          e.y < 280 &&
          !e.hidden,
      )
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
        e.disguise || "",
        +!!e.squeeze,
        +!!e.red,
        round(e.vy),
        e.deathKind || "",
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
