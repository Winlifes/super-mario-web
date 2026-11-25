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

test('two players cannot collect the same question block twice', () => {
  const world = createWorld(3); world.phase = 'playing';
  const block = world.level.platforms.find(tile => tile.content === 'coin');
  for (let i = 0; i < 2; i++) {
    const p = addPlayer(world,`p${i}`,i);
    p.x=block.x; p.y=block.y+16; p.vy=-100;
  }
  stepWorld(world);
  assert.equal(world.used.size,1);
  assert.equal(world.coins,1);
  assert.equal(world.score,200);
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
