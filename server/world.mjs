import { makeLevel } from '../shared/level.mjs';

const DT = 1 / 60;
const GRAVITY = 900;
const neutral = Object.freeze({ axis: 0, jump: false, fire: false, run: false });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const round = n => Math.round(n * 10) / 10;

export function createWorld(seed = 1) {
  const level = makeLevel(seed);
  return {
    level, seed, tick: 0, phase: 'countdown', countdown: 180, time: 300,
    players: new Map(), enemies: level.enemies.map(e => ({ ...e, vy: 0, w: 14, h: 14, dead: 0 })),
    items: [], bullets: [], used: new Set(), broken: new Set(), taken: new Set(),
    score: 0, coins: 0, events: [], eventId: 0, entityId: 0,
  };
}

export function addPlayer(world, id, slot) {
  const p = {
    id, slot, x: 40 + slot * 22, y: 192, w: 14, h: 16, vx: 0, vy: 0,
    form: 0, facing: 1, ground: false, alive: true, connected: true,
    lives: 3, checkpoint: 48, invincibleUntil: 0, respawnAt: 0,
    lastJump: false, lastFire: false, jumpAt: -1000, nextFire: 0,
  };
  world.players.set(id, p);
  return p;
}

export function emit(world, type, x, y, playerId = '') {
  world.events.push({ id: ++world.eventId, type, x: round(x), y: round(y), playerId });
  if (world.events.length > 16) world.events.shift();
}

function solids(world, body) {
  return world.level.platforms.filter(p => !world.broken.has(p.id) && p.x < body.x + body.w + 24 && p.x + p.w > body.x - 24);
}

function move(world, body, dt, onCeiling = null) {
  let hitWall = false;
  body.x += body.vx * dt;
  for (const tile of solids(world, body)) {
    if (!overlap(body, tile)) continue;
    if (body.vx > 0) body.x = tile.x - body.w;
    else if (body.vx < 0) body.x = tile.x + tile.w;
    hitWall = true;
  }
  if (hitWall) body.vx = -body.vx;
  body.ground = false;
  body.y += body.vy * dt;
  for (const tile of solids(world, body)) {
    if (!overlap(body, tile)) continue;
    if (body.vy > 0) {
      body.y = tile.y - body.h;
      body.ground = true;
    } else if (body.vy < 0) {
      body.y = tile.y + tile.h;
      if (onCeiling) onCeiling(tile);
    }
    body.vy = 0;
  }
  return hitWall;
}

function setForm(p, form) {
  const height = form ? 32 : 16;
  p.y += p.h - height;
  p.h = height;
  p.form = form;
}

function collectCoin(world, p, x, y) {
  world.coins++;
  world.score += 200;
  if (world.coins % 100 === 0) for (const member of world.players.values()) member.lives = Math.min(member.lives + 1, 99);
  emit(world, 'coin', x, y, p.id);
}

function hitBlock(world, p, block) {
  if (block.type === 'question' && !world.used.has(block.id)) {
    world.used.add(block.id);
    emit(world, 'bump', block.x, block.y, p.id);
    if (block.content === 'coin') collectCoin(world, p, block.x, block.y - 16);
    else {
      const type = block.content === 'flower' && p.form ? 'flower' : 'mushroom';
      world.items.push({ id: `i${world.entityId++}`, type, x: block.x, y: block.y - 16, w: 14, h: 16, vx: type === 'mushroom' ? 42 : 0, vy: 0 });
      emit(world, 'appear', block.x, block.y, p.id);
    }
  } else if (block.type === 'brick' && p.form && !world.broken.has(block.id)) {
    world.broken.add(block.id);
    world.score += 50;
    emit(world, 'break', block.x, block.y, p.id);
  }
}

function loseLife(world, p) {
  if (!p.alive) return;
  p.lives--;
  p.alive = false;
  p.vx = 0;
  p.vy = 0;
  p.respawnAt = p.lives > 0 ? world.tick + 120 : 0;
  emit(world, 'die', p.x, p.y, p.id);
}

function hurt(world, p) {
  if (!p.alive || world.tick < p.invincibleUntil) return;
  if (p.form) {
    setForm(p, p.form - 1);
    p.invincibleUntil = world.tick + 150;
    emit(world, 'hurt', p.x, p.y, p.id);
  } else loseLife(world, p);
}

export function stepWorld(world, inputs = new Map()) {
  world.tick++;
  if (world.phase === 'countdown') {
    world.countdown--;
    if (world.countdown <= 0) world.phase = 'playing';
    return;
  }
  if (world.phase !== 'playing') return;
  world.time = Math.max(0, world.time - DT);
  if (world.time <= 0) {
    world.phase = 'lost';
    emit(world, 'timeup', 0, 0);
    return;
  }
  for (const p of world.players.values()) {
    if (!p.alive) {
      if (p.respawnAt && world.tick >= p.respawnAt && p.connected) {
        p.x = p.checkpoint;
        p.y = 176;
        setForm(p, 0);
        p.vx = 0;
        p.vy = 0;
        p.alive = true;
        p.respawnAt = 0;
        p.invincibleUntil = world.tick + 180;
        emit(world, 'respawn', p.x, p.y, p.id);
      }
      continue;
    }
    const input = p.connected ? (inputs.get(p.id) || neutral) : neutral;
    const speed = input.run ? 148 : 105;
    const target = input.axis * speed;
    const acceleration = p.ground ? 700 : 430;
    p.vx += clamp(target - p.vx, -acceleration * DT, acceleration * DT);
    if (input.axis) p.facing = input.axis;
    if (input.jump && !p.lastJump && p.ground) {
      p.vy = -315;
      p.jumpAt = world.tick;
      emit(world, 'jump', p.x, p.y, p.id);
    }
    const gravity = input.jump && p.vy < 0 && world.tick - p.jumpAt < 15 ? 520 : GRAVITY;
    p.vy = Math.min(480, p.vy + gravity * DT);
    if (move(world, p, DT, tile => hitBlock(world, p, tile))) p.vx = 0;
    p.x = clamp(p.x, 0, world.level.width - p.w);
    if (p.y > world.level.height + 24) loseLife(world, p);
    if (p.alive && input.fire && !p.lastFire && p.form === 2 && world.tick >= p.nextFire && world.bullets.filter(b => b.owner === p.id).length < 2) {
      world.bullets.push({ id: `f${world.entityId++}`, owner: p.id, x: p.x + 7, y: p.y + 12, w: 6, h: 6, vx: p.facing * 260, vy: 80, until: world.tick + 150 });
      p.nextFire = world.tick + 15;
      emit(world, 'fire', p.x, p.y, p.id);
    }
    p.lastJump = input.jump;
    p.lastFire = input.fire;
    for (const point of world.level.checkpoints) if (p.x >= point + 60) p.checkpoint = point;
    if (!p.alive) continue;
    for (const coin of world.level.coins) {
      if (!world.taken.has(coin.id) && overlap(p, { x: coin.x - 6, y: coin.y - 7, w: 12, h: 14 })) {
        world.taken.add(coin.id);
        collectCoin(world, p, coin.x, coin.y);
      }
    }
    if (p.x + p.w >= world.level.goal.x && p.y + p.h > 55) {
      world.phase = 'won';
      world.score += 2000 + Math.ceil(world.time) * 50;
      emit(world, 'win', p.x, p.y, p.id);
    }
  }
  for (const enemy of world.enemies) {
    if (enemy.dead) continue;
    enemy.vy = Math.min(480, enemy.vy + GRAVITY * DT);
    move(world, enemy, DT);
    if (enemy.y > world.level.height + 24) enemy.dead = world.tick;
    for (const p of world.players.values()) {
      if (!p.alive || !p.connected || enemy.dead || !overlap(p, enemy)) continue;
      if (p.vy > 5 && p.y + p.h - enemy.y < 12) {
        enemy.dead = world.tick;
        p.vy = -205;
        world.score += 100;
        emit(world, 'stomp', enemy.x, enemy.y, p.id);
      } else hurt(world, p);
    }
  }
  for (const item of world.items) {
    if (item.type === 'mushroom') {
      item.vy = Math.min(480, item.vy + GRAVITY * DT);
      move(world, item, DT);
    }
    for (const p of world.players.values()) {
      if (!p.alive || item.used || !overlap(p, item)) continue;
      setForm(p, item.type === 'flower' ? 2 : Math.max(1, p.form));
      p.invincibleUntil = Math.max(p.invincibleUntil, world.tick + 45);
      item.used = true;
      world.score += 1000;
      emit(world, 'powerup', item.x, item.y, p.id);
    }
  }
  world.items = world.items.filter(i => !i.used && i.y < world.level.height + 24);
  for (const bullet of world.bullets) {
    bullet.vy = Math.min(400, bullet.vy + GRAVITY * DT);
    if (move(world, bullet, DT)) bullet.until = 0;
    if (bullet.ground) bullet.vy = -180;
    for (const enemy of world.enemies) {
      if (!enemy.dead && overlap(bullet, enemy)) {
        enemy.dead = world.tick;
        bullet.until = 0;
        world.score += 100;
        emit(world, 'stomp', enemy.x, enemy.y, bullet.owner);
      }
    }
  }
  world.bullets = world.bullets.filter(b => b.until > world.tick && b.y < world.level.height && b.x > 0 && b.x < world.level.width);
  const members = [...world.players.values()].filter(p => p.connected);
  if (members.length && members.every(p => !p.alive && p.lives <= 0)) world.phase = 'lost';
}

export function snapshot(world) {
  return {
    type: 'state', tick: world.tick, phase: world.phase, countdown: Math.ceil(world.countdown / 60),
    time: Math.ceil(world.time), score: world.score, coins: world.coins,
    players: [...world.players.values()].map(p => [p.id, round(p.x), round(p.y), round(p.vx), round(p.vy), p.form, p.facing, +p.alive, +(world.tick < p.invincibleUntil), p.lives, +p.connected]),
    enemies: world.enemies.filter(e => !e.dead || world.tick - e.dead < 25).map(e => [e.id, round(e.x), round(e.y), round(e.vx), +!!e.dead]),
    items: world.items.map(i => [i.id, round(i.x), round(i.y), i.type]),
    bullets: world.bullets.map(b => [b.id, round(b.x), round(b.y)]),
    used: [...world.used], broken: [...world.broken], taken: [...world.taken], events: world.events,
  };
}
