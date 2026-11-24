(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const colors = ['#ff705e', '#73df95', '#ffd66e', '#9eb6ff'];
  const keyState = new Set();
  const touchState = new Map();
  const readStorage = (store, key) => { try { return store.getItem(key); } catch { return null; } };
  const writeStorage = (store, key, value) => { try { store.setItem(key, value); } catch {} };
  let socket, me, token, code, room, coopGame, scene, latestState, latestLevel;
  let round = 0, installedRound = -1, assetsReady = false, intentional = false, connecting = false, reconnectAt = 0, retry = 0, seq = 0;
  let muted = readStorage(localStorage, 'coop-muted') === 'true';
  let seenEvent = 0, lastHud = 0;
  $('nickname').value = readStorage(localStorage, 'coop-name') || '玩家';
  $('mute-button').textContent = muted ? '声音关' : '声音开';
  $('mute-button').setAttribute('aria-pressed', String(muted));
  const incomingCode = new URL(location.href).searchParams.get('room');
  if (incomingCode) $('room-code').value = incomingCode.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);

  function status(message, ok = false) {
    $('status').textContent = message;
    $('status').classList.toggle('ok', ok);
  }
  function busy(value) {
    connecting = value;
    $('create-room').disabled = value;
    $('join-room').disabled = value;
  }
  function send(message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  function resetInput() { keyState.clear(); touchState.clear(); document.querySelectorAll('[data-control]').forEach(b => b.classList.remove('pressed')); }
  function input() {
    const controls = [...touchState.values()];
    const left = keyState.has('KeyA') || keyState.has('ArrowLeft') || controls.includes('left');
    const right = keyState.has('KeyD') || keyState.has('ArrowRight') || controls.includes('right');
    return {
      type: 'input', seq: ++seq, axis: Number(right) - Number(left),
      jump: keyState.has('Space') || keyState.has('KeyW') || keyState.has('ArrowUp') || controls.includes('jump'),
      fire: keyState.has('KeyQ') || keyState.has('KeyF') || controls.includes('fire'),
      run: keyState.has('ShiftLeft') || keyState.has('ShiftRight') || controls.length > 0,
    };
  }
  function renderRoom() {
    if (!room) return;
    $('entry-panel').hidden = true;
    $('room-panel').hidden = false;
    $('room-label').textContent = room.code;
    const list = $('players');
    list.replaceChildren();
    room.players.forEach(p => {
      const li = document.createElement('li');
      const mark = document.createElement('span'); mark.className = 'seat-mark'; mark.style.background = colors[p.slot];
      const name = document.createElement('span'); name.className = 'player-name';
      name.textContent = `${p.name}${p.id === me ? '（你）' : ''}${p.id === room.hostId ? ' · 房主' : ''}`;
      const state = document.createElement('span'); state.className = p.ready && p.connected ? 'player-ready' : 'player-wait';
      state.textContent = !p.connected ? '等待重连' : p.ready ? '已准备' : '未准备';
      li.append(mark, name, state); list.append(li);
    });
    const self = room.players.find(p => p.id === me);
    const online = room.players.filter(p => p.connected);
    $('ready-button').textContent = !assetsReady ? '游戏资源加载中…' : self?.ready ? '取消准备' : '准备';
    $('ready-button').disabled = !assetsReady;
    $('start-button').hidden = room.hostId !== me;
    $('start-button').disabled = online.length < 2 || online.some(p => !p.ready);
    $('room-help').textContent = online.length < 2 ? '复制邀请链接，等至少一位朋友加入。' : online.some(p => !p.ready) ? '所有在线玩家准备后，房主即可开始。' : '全员已准备，房主可以开始闯关。';
  }

  function connect(mode, requestedCode = '', resumeToken = null) {
    if (connecting || (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState))) return;
    busy(true); intentional = false;
    const name = $('nickname').value.trim().slice(0, 16) || '玩家';
    writeStorage(localStorage, 'coop-name', name);
    status(resumeToken ? '正在恢复房间连接…' : '正在连接合作房间…');
    const endpoint = new URL('ws', location.href);
    endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(endpoint);
    socket = ws;
    ws.addEventListener('open', () => send({ type: 'hello', mode, code: requestedCode, token: resumeToken, name }));
    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'welcome') {
        me = message.id; token = message.token; code = message.code; retry = 0; reconnectAt = 0; seq = 0;
        busy(false); status(message.resumed ? '连接已恢复。' : '房间已连接，邀请朋友一起加入。', true);
        $('connection-state').textContent = '已连接';
        writeStorage(sessionStorage, 'coop-session', JSON.stringify({ code, token }));
        const url = new URL(location.href); url.searchParams.set('room', code); history.replaceState(null, '', url);
        bootCoop();
      } else if (message.type === 'room') {
        room = message; renderRoom();
        if (message.phase === 'lobby') {
          $('lobby').hidden = false; $('game-toolbar').hidden = true; $('round-message').hidden = true; $('touch-controls').hidden = true;
          latestState = null; resetInput();
          if (scene?.music) scene.music.stop();
        }
      } else if (message.type === 'start') {
        latestLevel = message.level; round = message.round;
        $('lobby').hidden = true; $('game-toolbar').hidden = false;
        $('touch-controls').hidden = !matchMedia('(pointer:coarse)').matches;
        resetInput(); seenEvent = 0;
        if (scene) scene.installLevel(latestLevel, round);
      } else if (message.type === 'state') {
        latestState = { ...message, receivedAt: performance.now() };
      } else if (message.type === 'pong') {
        $('connection-state').textContent = `已连接 · ${Math.max(0, Date.now() - message.at)} ms`;
      } else if (message.type === 'error') {
        status(message.message); busy(false);
        if (message.message.includes('重连席位')) { token = null; writeStorage(sessionStorage, 'coop-session', ''); }
      }
    });
    ws.addEventListener('close', event => {
      if (socket !== ws) return;
      busy(false); resetInput();
      if (intentional) return;
      $('connection-state').textContent = '连接已断开';
      if (event.code === 1008 || !token || !code) {
        if (room && latestState) { $('round-message').hidden = false; $('round-title').textContent = '连接已中断'; $('round-detail').textContent = '请退出房间后重新加入。'; $('again-button').hidden = true; }
        if (!$('status').textContent || $('status').classList.contains('ok')) status('无法连接房间，请检查网络后重试。');
        return;
      }
      if (!reconnectAt) reconnectAt = Date.now();
      if (Date.now() - reconnectAt >= 43000) {
        status('重连超时，请退出后重新加入房间。'); return;
      }
      $('connection-state').textContent = '网络中断，正在重连…';
      status('网络中断，席位会保留45秒，正在自动重连…');
      setTimeout(() => connect('join', code, token), Math.min(500 * 2 ** retry++, 3000));
    });
    ws.addEventListener('error', () => {});
  }

  function leave() {
    intentional = true; send({ type: 'leave' }); socket?.close();
    writeStorage(sessionStorage, 'coop-session', '');
    const url = new URL(location.href); url.searchParams.delete('room'); location.assign(url.pathname);
  }
  $('create-room').addEventListener('click', () => connect('create'));
  $('join-form').addEventListener('submit', event => { event.preventDefault(); connect('join', $('room-code').value.trim().toUpperCase()); });
  $('room-code').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''); });
  $('ready-button').addEventListener('click', () => { const self = room?.players.find(p => p.id === me); send({ type: 'ready', ready: !self?.ready }); });
  $('start-button').addEventListener('click', () => send({ type: 'start' }));
  $('again-button').addEventListener('click', () => send({ type: 'again' }));
  $('leave-lobby').addEventListener('click', leave); $('leave-game').addEventListener('click', leave);
  $('copy-invite').addEventListener('click', async () => {
    const url = new URL(location.href); url.searchParams.set('room', code);
    try { await navigator.clipboard.writeText(url.href); status('邀请链接已复制，发给朋友即可加入。', true); }
    catch { status(`房间码：${code}。可以复制浏览器地址栏发送给朋友。`, true); }
  });
  $('mute-button').addEventListener('click', () => {
    muted = !muted; writeStorage(localStorage, 'coop-muted', String(muted));
    $('mute-button').textContent = muted ? '声音关' : '声音开'; $('mute-button').setAttribute('aria-pressed', String(muted));
    if (scene) scene.sound.mute = muted;
  });
  $('classic-mode').addEventListener('click', () => {
    $('lobby').hidden = true; $('game').hidden = false; $('back-classic').hidden = false; startClassicGame();
  });
  $('back-classic').addEventListener('click', () => location.assign(location.pathname));
  document.addEventListener('keydown', event => {
    if (!$('game-toolbar').hidden && ['KeyA','KeyD','ArrowLeft','ArrowRight','Space','KeyW','ArrowUp','KeyQ','KeyF','ShiftLeft','ShiftRight'].includes(event.code)) {
      event.preventDefault(); keyState.add(event.code);
    }
  });
  document.addEventListener('keyup', event => keyState.delete(event.code));
  window.addEventListener('blur', () => { resetInput(); send(input()); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { resetInput(); send(input()); } });
  for (const button of document.querySelectorAll('[data-control]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId); touchState.set(event.pointerId, button.dataset.control); button.classList.add('pressed');
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, event => {
      touchState.delete(event.pointerId); button.classList.remove('pressed');
    });
    button.addEventListener('contextmenu', event => event.preventDefault());
  }
  setInterval(() => { if (latestState && ['playing','countdown'].includes(latestState.phase)) send(input()); }, 1000 / 30);
  setInterval(() => { if (me) send({ type: 'ping', at: Date.now() }); }, 2500);

  function bootCoop() {
    if (coopGame) return;
    $('coop-game').hidden = false;
    class CoopScene extends Phaser.Scene {
      constructor() { super('cooperation'); }
      preload() {
        const images = {
          'ground':'scenery/overworld/floorbricks.png','brick':'blocks/overworld/block.png','empty':'blocks/overworld/emptyBlock.png','stone':'blocks/overworld/immovableBlock.png',
          'pipe':'scenery/vertical-small-tube.png','flagpole':'scenery/flag-mast.png','flag':'scenery/final-flag.png','castle':'scenery/castle.png',
          'cloud':'scenery/overworld/cloud1.png','hill':'scenery/overworld/mountain2.png','bush':'scenery/overworld/bush1.png','mushroom':'collectibles/super-mushroom.png',
        };
        Object.entries(images).forEach(([key, value]) => this.load.image(`coop-${key}`, `assets/${value}`));
        for (const [key, filename, w, h] of [
          ['small','entities/mario.png',18,16],['big','entities/mario-grown.png',18,32],['fire','entities/mario-fire.png',18,32],
          ['goomba','entities/overworld/goomba.png',16,16],['coin','collectibles/coin.png',16,16],['question','blocks/overworld/misteryBlock.png',16,16],
          ['flower','collectibles/overworld/fire-flower.png',16,16],['bullet','entities/fireball.png',8,8],
        ]) this.load.spritesheet(`coop-${key}`, `assets/${filename}`, { frameWidth:w, frameHeight:h });
        for (const [key, filename] of Object.entries({ jump:'effects/jump.mp3',coin:'effects/coin.mp3',bump:'effects/block-bump.wav',break:'effects/break-block.wav',appear:'effects/powerup-appears.mp3',powerup:'effects/consume-powerup.mp3',hurt:'effects/powerdown.mp3',stomp:'effects/goomba-stomp.wav',fire:'effects/fireball.mp3',win:'music/win.wav' })) {
          this.load.audio(`coop-${key}`, `assets/sound/${filename}`);
        }
        this.load.audio('coop-music', 'assets/sound/music/overworld/theme.mp3');
        this.load.on('progress', value => { if (!$('lobby').hidden) status(`正在准备联机资源 ${Math.round(value * 100)}%…`); });
        this.load.on('loaderror', () => status('部分游戏资源加载失败，请刷新页面重试。'));
      }
      create() {
        scene = this; this.sound.mute = muted;
        this.music = this.sound.add('coop-music', { loop:true, volume:.16 });
        this.scale.on('resize', this.resizeCamera, this);
        assetsReady = true; renderRoom(); status('游戏资源已准备好，可以点击准备。', true);
        if (latestLevel) this.installLevel(latestLevel, round);
      }
      resizeCamera() {
        const width = this.scale.width, height = this.scale.height;
        this.cameras.main.setViewport(0,0,width,height).setZoom(Math.min(height / 240, width / 320));
      }
      installLevel(level, currentRound) {
        if (installedRound === currentRound && this.level) return;
        installedRound = currentRound; this.level = level; latestState = null; seenEvent = 0;
        this.children.removeAll(true);
        this.actors = new Map(); this.enemies = new Map(); this.items = new Map(); this.bullets = new Map(); this.tiles = new Map(); this.coins = new Map();
        this.cameras.main.setBackgroundColor('#8585ff').setBounds(0,0,level.width,level.height);
        for (let x = 80; x < level.width; x += 230) {
          this.add.image(x,48 + (x % 37),'coop-cloud').setDisplaySize(60,29).setScrollFactor(.65);
          this.add.image(x + 80,208,'coop-hill').setOrigin(.5,1).setDisplaySize(72,36);
          this.add.image(x - 30,208,'coop-bush').setOrigin(.5,1).setDisplaySize(48,16);
        }
        for (const tile of level.platforms) {
          let image;
          if (tile.type === 'ground') image = this.add.tileSprite(tile.x,tile.y,tile.w,tile.h,'coop-ground').setOrigin(0);
          else if (tile.type === 'question') image = this.add.sprite(tile.x,tile.y,'coop-question',0).setOrigin(0);
          else if (tile.type === 'pipe') image = this.add.image(tile.x,tile.y,'coop-pipe').setOrigin(0).setDisplaySize(tile.w,tile.h);
          else if (tile.type === 'stone') image = this.add.tileSprite(tile.x,tile.y,tile.w,tile.h,'coop-stone').setOrigin(0);
          else image = this.add.image(tile.x,tile.y,'coop-brick').setOrigin(0);
          image.setDepth(2); this.tiles.set(tile.id,image);
        }
        for (const coin of level.coins) this.coins.set(coin.id,this.add.sprite(coin.x,coin.y,'coop-coin',0).setDepth(3));
        this.add.image(level.goal.x,208,'coop-flagpole').setOrigin(.5,1).setDepth(1);
        this.flag = this.add.image(level.goal.x - 1,48,'coop-flag').setOrigin(1,.5).setDepth(2);
        this.add.image(level.goal.x + 80,208,'coop-castle').setOrigin(.5,1).setDepth(1);
        this.resizeCamera();
        this.music.stop(); if (!muted) this.music.play();
        $('round-message').hidden = true; lastHud = 0;
      }
      update(time, delta) {
        const state = latestState;
        if (!state || !this.level) return;
        const blend = 1 - Math.exp(-Math.min(delta,100) / 38);
        const frame = Math.floor(time / 120);
        for (const [id,image] of this.tiles) {
          if (state.broken.includes(id)) image.setVisible(false);
          else if (state.used.includes(id)) image.setTexture('coop-empty');
          else if (image.texture.key === 'coop-question') image.setFrame(frame % 3);
        }
        for (const [id,image] of this.coins) { image.setVisible(!state.taken.includes(id)); if (image.visible) image.setFrame(frame % 4); }
        const playerIds = new Set();
        for (const p of state.players) {
          const [id,x,y,vx,vy,form,facing,alive,invincible,lives,connected] = p;
          playerIds.add(id);
          const member = room?.players.find(member => member.id === id);
          let actor = this.actors.get(id);
          if (!actor) {
            const sprite = this.add.sprite(x+7,y+(form ? 32:16),'coop-small').setOrigin(.5,1).setDepth(5);
            const label = this.add.text(x,y-10,`P${(member?.slot || 0)+1}${id===me?' YOU':''}`,{ fontFamily:'monospace',fontSize:'7px',color:colors[member?.slot || 0],stroke:'#15254b',strokeThickness:1 }).setResolution(3).setOrigin(.5,1).setDepth(6);
            const marker = this.add.rectangle(x,y,12,2,Phaser.Display.Color.HexStringToColor(colors[member?.slot || 0]).color).setDepth(4);
            actor = { sprite,label,marker }; this.actors.set(id,actor);
          }
          const sprite = actor.sprite;
          const key = form === 2 ? 'coop-fire' : form ? 'coop-big' : 'coop-small';
          const animationFrame = Math.abs(vy) > 8 ? 5 : Math.abs(vx) > 3 ? 1 + frame % 3 : 0;
          sprite.setTexture(key,animationFrame).setFlipX(facing < 0).setVisible(Boolean(alive));
          const targetX = x + 7, targetY = y + (form ? 32 : 16);
          if (Math.abs(sprite.x-targetX)>70 || Math.abs(sprite.y-targetY)>70) sprite.setPosition(targetX,targetY);
          else sprite.setPosition(Phaser.Math.Linear(sprite.x,targetX,blend),Phaser.Math.Linear(sprite.y,targetY,blend));
          sprite.setAlpha(!connected ? .35 : invincible && frame % 2 ? .35 : 1);
          actor.label.setPosition(sprite.x,sprite.y-(form?35:19)).setVisible(Boolean(alive));
          actor.marker.setPosition(sprite.x,sprite.y+1).setVisible(Boolean(alive));
        }
        for (const [id,actor] of this.actors) if (!playerIds.has(id)) { actor.sprite.destroy();actor.label.destroy();actor.marker.destroy();this.actors.delete(id); }
        this.updateEntities(this.enemies,state.enemies,(e) => this.add.sprite(e[1]+7,e[2]+14,'coop-goomba').setOrigin(.5,1).setDepth(4),(sprite,e) => {
          sprite.setPosition(Phaser.Math.Linear(sprite.x,e[1]+7,blend),Phaser.Math.Linear(sprite.y,e[2]+14,blend)).setFrame(e[4]?2:frame%2);
        });
        this.updateEntities(this.items,state.items,(item) => this.add.sprite(item[1],item[2],item[3] === 'flower'?'coop-flower':'coop-mushroom').setOrigin(0).setDepth(4),(sprite,item) => {
          sprite.setPosition(item[1],item[2]); if (item[3] === 'flower') sprite.setFrame(frame%4);
        });
        this.updateEntities(this.bullets,state.bullets,(b) => this.add.sprite(b[1],b[2],'coop-bullet').setDepth(4),(sprite,b) => sprite.setPosition(b[1],b[2]).setFrame(frame%4));
        const self = this.actors.get(me);
        if (self) this.cameras.main.centerOn(self.sprite.x+35,120);
        if (state.phase === 'won') this.flag.y = Math.min(190,this.flag.y+delta*.08);
        for (const event of state.events) if (event.id > seenEvent) {
          seenEvent = event.id;
          if (!muted && this.cache.audio.exists(`coop-${event.type}`) && (event.playerId===me || !self || Math.abs(event.x-self.sprite.x)<350)) this.sound.play(`coop-${event.type}`,{volume:event.type==='win'?.35:.25});
        }
        if (time - lastHud > 100) { renderHud(state); lastHud = time; }
      }
      updateEntities(map, entries, create, update) {
        const ids = new Set();
        for (const entry of entries) {
          ids.add(entry[0]); let object = map.get(entry[0]);
          if (!object) { object = create(entry); map.set(entry[0],object); }
          update(object,entry);
        }
        for (const [id,object] of map) if (!ids.has(id)) { object.destroy();map.delete(id); }
      }
    }
    coopGame = new Phaser.Game({ type:Phaser.AUTO,parent:'coop-game',backgroundColor:'#8585ff',pixelArt:true,antialias:false,roundPixels:true,
      scale:{ mode:Phaser.Scale.RESIZE,width:window.innerWidth,height:window.innerHeight }, scene:CoopScene,
      input:{ keyboard:false }, audio:{ disableWebAudio:false }, fps:{ target:60,forceSetTimeOut:false },
    });
  }

  function renderHud(state) {
    $('team-score').textContent = `团队分数 ${String(state.score).padStart(6,'0')}`;
    $('team-coins').textContent = `金币 ${state.coins}`; $('game-time').textContent = `时间 ${state.time}`;
    $('team-members').textContent = state.players.map(p => {
      const member = room?.players.find(member => member.id === p[0]);
      return `${member?.name || '玩家'}${p[0]===me?'（你）':''} · ${p[9]}条命${!p[10]?' · 重连中':!p[7]?(p[9]>0?' · 复活中':' · 观战'):''}`;
    }).join('　');
    const ending = ['won','lost'].includes(state.phase);
    $('round-message').hidden = state.phase !== 'countdown' && !ending;
    if (state.phase === 'countdown') {
      $('round-title').textContent = String(Math.max(1,state.countdown)); $('round-detail').textContent = '所有人一起出发，任一队友到达旗杆即可过关。'; $('again-button').hidden = true;
    } else if (ending) {
      scene?.music?.stop(); resetInput();
      $('round-title').textContent = state.phase === 'won' ? '合作通关！' : '再试一次吧';
      $('round-detail').textContent = `团队分数 ${state.score}，共收集 ${state.coins} 枚金币。${room?.hostId!==me?'等待房主返回房间。':''}`;
      $('again-button').hidden = room?.hostId !== me;
    }
  }

  const saved = readStorage(sessionStorage,'coop-session');
  if (saved && incomingCode) {
    try { const session = JSON.parse(saved); if (session.code === incomingCode && session.token) connect('join',session.code,session.token); } catch {}
  }
})();
