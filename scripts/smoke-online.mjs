import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const base = new URL(process.argv[2] || 'http://127.0.0.1:2678/');
if (!base.pathname.endsWith('/')) base.pathname += '/';
const endpoint = new URL('ws', base); endpoint.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
async function join(hello) {
  const ws = new WebSocket(endpoint, { origin: base.origin });
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  ws.on('error', () => {});
  const c = { ws, messages, send: message => ws.send(JSON.stringify(message)), async wait(predicate, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = messages.find(predicate); if (found) return found;
      await delay(20);
    }
    throw new Error('Public multiplayer message timed out');
  } };
  clients.push(c);
  await once(ws, 'open');
  c.send({ type: 'hello', ...hello });
  return c;
}
try {
  const health = await fetch(new URL('api/health', base)); assert.equal(health.status, 200);
  const host = await join({ mode: 'create', name: '联机验证1', stage: process.argv[3] || '1-1' });
  const welcome = await host.wait(m => m.type === 'welcome');
  for (let i = 1; i < 4; i++) {
    const c = await join({ mode: 'join', code: welcome.code, name: `联机验证${i + 1}` });
    await c.wait(m => m.type === 'welcome');
  }
  const fifth = await join({ mode: 'join', code: welcome.code, name: '容量验证' });
  await fifth.wait(m => m.type === 'error' && m.message.includes('4名'));
  const members = clients.slice(0, 4);
  for (const c of members) c.send({ type: 'ready', ready: true });
  await host.wait(m => m.type === 'room' && m.players.length === 4 && m.players.every(p => p.ready));
  host.send({ type: 'start' });
  const courses = await Promise.all(members.map(c => c.wait(m => m.type === 'start')));
  for (const course of courses) assert.deepEqual(course.level, courses[0].level);
  const initial = await host.wait(m => m.type === 'state' && m.phase === 'playing');
  const same = await Promise.all(members.map(c => c.wait(m => m.type === 'state' && m.tick === initial.tick)));
  for (const state of same) { assert.deepEqual(state.players, initial.players); assert.deepEqual(state.enemies, initial.enemies); }
  let seq = 0;
  const moving = setInterval(() => host.send({ type: 'input', seq: ++seq, axis: 1, jump: false, fire: false, run: false }), 35);
  await delay(650); clearInterval(moving);
  host.send({ type: 'input', seq: ++seq, axis: 0, jump: false, fire: false, run: false });
  const later = await host.wait(m => m.type === 'state' && m.tick > initial.tick + 42);
  assert.ok(later.players.find(p => p[0] === welcome.id)[1] > initial.players.find(p => p[0] === welcome.id)[1] + 20);
  const before = members[2].messages.find(m => m.type === 'welcome');
  members[2].ws.terminate(); await delay(150);
  const restored = await join({ mode: 'join', code: welcome.code, token: before.token });
  const resumed = await restored.wait(m => m.type === 'welcome');
  assert.equal(resumed.id, before.id); assert.equal(resumed.resumed, true);
  assert.equal((await restored.wait(m => m.type === 'state')).players.length, 4);
  console.log(JSON.stringify({ status: 'passed', origin: base.origin, path: base.pathname, stage: courses[0].level.stage, players: 4, sharedLevel: true, sharedState: true, movement: true, capacityLimit: true, reconnect: true, encryptedWebSocket: endpoint.protocol === 'wss:' }));
} finally {
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.send({ type: 'leave' });
    c.ws.close();
  }
  await delay(250);
  for (const c of clients) c.ws.terminate();
}
