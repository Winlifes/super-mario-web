import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, addPlayer, stepWorld, snapshot } from '../server/world.mjs';

test('all four players use one world; only the addressed player responds to input', () => {
  const world = createWorld(3); world.phase = 'playing';
  for (let i = 0; i < 4; i++) addPlayer(world, `p${i}`, i);
  for (let i = 0; i < 60; i++) stepWorld(world, new Map([['p0',{axis:1,jump:false,fire:false,run:false}]]));
  assert.ok(world.players.get('p0').x > 100);
  assert.equal(world.players.get('p1').x,62);
  assert.equal(snapshot(world).players.length,4);
  assert.equal(snapshot(world).enemies.length,world.enemies.filter(e=>!e.dead||world.tick-e.dead<25).length);
});

test('a coin block awards one shared coin on impact and briefly shows the pop', () => {
  const world = createWorld(3);
  world.phase = 'playing';
  world.enemies = [];
  const block = world.level.platforms.find(tile => tile.content === 'coin');
  const players = [addPlayer(world, 'p0', 0), addPlayer(world, 'p1', 1)];
  for (const player of players) {
    player.x = block.x;
    player.y = block.y + block.h;
    player.vy = -100;
  }
  stepWorld(world);
  assert.ok(world.used.has(block.id));
  const impact = snapshot(world);
  assert.equal(impact.coins, 1);
  assert.equal(impact.score, 200);
  assert.equal(impact.items.length, 1);
  const [pop] = impact.items;
  assert.equal(pop[3], 'coin');
  assert.equal(pop[2], block.y - 16);
  assert.equal(world.items.length, 0);
  assert.equal(world.events.filter(event => event.type === 'coin').length, 1);

  for (let i = 0; i < 15; i++) stepWorld(world);
  const [peak] = snapshot(world).items;
  assert.equal(peak[0], pop[0]);
  assert.ok(peak[2] < pop[2]);
  for (const player of players) Object.assign(player, { x: peak[1], y: peak[2], vy: 0 });
  stepWorld(world);
  assert.equal(snapshot(world).items.length, 1);
  assert.equal(world.coins, 1);
  assert.equal(world.score, 200);

  for (let i = 0; i < 20; i++) stepWorld(world);
  assert.equal(snapshot(world).items.length, 0);
  assert.equal(world.coins, 1);
  assert.equal(world.score, 200);
  assert.equal(world.events.filter(event => event.type === 'coin').length, 1);
});

test('a multi-coin brick awards each eligible hit immediately and then runs out', () => {
  const world = createWorld(1);
  world.phase = 'playing';
  world.enemies = [];
  const block = world.level.platforms.find(tile => tile.content === 'multi');
  const player = addPlayer(world, 'p0', 0);
  for (let hit = 1; hit <= 10; hit++) {
    Object.assign(player, { x: block.x, y: block.y + block.h, vy: -100 });
    stepWorld(world);
    assert.equal(world.coins, hit);
    assert.equal(world.score, hit * 200);
    for (let tick = 0; tick < 7; tick++) stepWorld(world);
  }
  assert.ok(world.used.has(block.id));
  Object.assign(player, { x: block.x, y: block.y + block.h, vy: -100 });
  stepWorld(world);
  assert.equal(world.coins, 10);
  assert.equal(world.score, 2000);
});

test('falling costs a life and respawns a player without resetting teammates', () => {
  const world=createWorld(1); world.phase='playing';
  const a=addPlayer(world,'a',0),b=addPlayer(world,'b',1);
  b.form=1; b.h=32; b.y=176;
  a.y=300; stepWorld(world);
  assert.equal(a.alive,false); assert.equal(a.lives,2);
  for(let i=0;i<121;i++) stepWorld(world);
  assert.equal(a.alive,true); assert.equal(a.lives,2);
  assert.equal(b.form,1); assert.equal(b.lives,3);
});

test('a teammate reaching the goal finishes the shared round once', () => {
  const world=createWorld(1); world.phase='playing';
  const a=addPlayer(world,'a',0); addPlayer(world,'b',1);
  a.x=world.level.goal.x; stepWorld(world);
  const score=world.score;
  for(let i=0;i<60;i++) stepWorld(world);
  assert.equal(world.phase,'cleared'); assert.equal(world.score,score);
  assert.equal(world.events.filter(event=>event.type==='flagpole').length,1);
});

test('short and held jumps differ, and walking cannot cross solid pipes', () => {
  const heights=[];
  for(const hold of [1,15]) {
    const world=createWorld(1);world.phase='playing';const p=addPlayer(world,'a',0);
    stepWorld(world);let top=p.y;
    for(let i=0;i<50;i++) {stepWorld(world,new Map([['a',{axis:0,jump:i<hold,fire:false,run:false}]]));top=Math.min(top,p.y);}
    heights.push(top);
  }
  assert.ok(heights[1]<heights[0]-12);
  const world=createWorld(1);world.phase='playing';const p=addPlayer(world,'a',0);
  p.x=420;
  for(let i=0;i<100;i++) stepWorld(world,new Map([['a',{axis:1,jump:false,fire:false,run:false}]]));
  assert.ok(p.x+14<=448.1);
});
