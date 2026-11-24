import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function client(base, hello) {
  const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws',{origin:base});
  const messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
  await once(ws,'open');ws.send(JSON.stringify({type:'hello',...hello}));
  return {ws,messages,send(value){ws.send(JSON.stringify(value));},async wait(predicate,timeout=5000){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){const message=messages.find(predicate);if(message)return message;await delay(10);}
    throw new Error('Timed out waiting for server message');
  }};
}

test('four real WebSocket clients: capacity, readiness, shared state, stopped input, reconnect and host transfer', {timeout:15000},async t=>{
  const app=createGameServer({reconnectMs:2000});const address=await app.listen(0);
  const base=`http://127.0.0.1:${address.port}`;const clients=[];
  t.after(async()=>{for(const c of clients)c.ws.terminate();await app.close();});
  const host=await client(base,{mode:'create',name:'host'});clients.push(host);
  const welcome=await host.wait(m=>m.type==='welcome');
  host.send({type:'start'});
  await host.wait(m=>m.type==='error'&&m.message.includes('至少2名'));
  for(let i=1;i<4;i++){const c=await client(base,{mode:'join',code:welcome.code,name:`p${i}`});clients.push(c);await c.wait(m=>m.type==='welcome');}
  const fifth=await client(base,{mode:'join',code:welcome.code,name:'fifth'});clients.push(fifth);
  await fifth.wait(m=>m.type==='error'&&m.message.includes('4名'));
  assert.equal(app.rooms.get(welcome.code).players.size,4);
  host.send({type:'start'});await host.wait(m=>m.type==='error'&&m.message.includes('准备'));
  for(const c of clients.slice(0,4)) c.send({type:'ready',ready:true});
  await host.wait(m=>m.type==='room'&&m.players.length===4&&m.players.every(p=>p.ready));
  host.send({type:'start'});
  for(const c of clients.slice(0,4)) await c.wait(m=>m.type==='start');
  const first=await host.wait(m=>m.type==='state'&&m.phase==='playing');
  const matching=await clients[1].wait(m=>m.type==='state'&&m.tick===first.tick);
  assert.deepEqual(first.players,matching.players);assert.deepEqual(first.enemies,matching.enemies);
  let sequence=0;
  const control=setInterval(()=>host.send({type:'input',seq:++sequence,axis:1,jump:false,run:false,fire:false,x:999999,score:999999}),30);
  await delay(700);clearInterval(control);
  const room=app.rooms.get(welcome.code),actor=room.world.players.get(welcome.id);
  assert.ok(actor.x>70&&actor.x<160);assert.equal(room.world.score,0);
  await delay(1000);const stopped=actor.x;await delay(300);assert.ok(Math.abs(actor.x-stopped)<1);
  const secondWelcome=clients[1].messages.find(m=>m.type==='welcome');
  clients[1].ws.terminate();await delay(40);
  const resumed=await client(base,{mode:'join',code:welcome.code,token:secondWelcome.token});clients.push(resumed);
  const resumedWelcome=await resumed.wait(m=>m.type==='welcome');
  assert.equal(resumedWelcome.id,secondWelcome.id);assert.equal(resumedWelcome.resumed,true);
  assert.equal(room.players.size,4);assert.equal(room.world.players.size,4);
  host.ws.terminate();await delay(50);assert.notEqual(room.hostId,welcome.id);
  const response=await fetch(base+'/api/health');assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  assert.equal((await fetch(base+'/%2eopenai/unused-sites-hosting.json')).status,404);
});

test('bad tokens and foreign WebSocket origins do not crash or join the server', {timeout:5000},async t=>{
  const app=createGameServer();const address=await app.listen(0);const base=`http://127.0.0.1:${address.port}`;
  const host=await client(base,{mode:'create',name:'host'});
  t.after(async()=>{host.ws.terminate();await app.close();});
  const welcome=await host.wait(m=>m.type==='welcome');
  const bad=await client(base,{mode:'join',code:welcome.code,token:'你'.repeat(48)});
  await bad.wait(m=>m.type==='error');bad.ws.terminate();
  const foreign=new WebSocket(base.replace('http','ws')+'/ws',{origin:'https://foreign.example'});
  foreign.on('error',()=>{});
  const response=await new Promise(resolve=>foreign.once('unexpected-response',(_request,response)=>{response.resume();resolve(response);}));
  assert.equal(response.statusCode,403);foreign.terminate();
  assert.equal((await fetch(base+'/api/health')).status,200);
});
