(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const courseSelect = $("stage-choice");
  courseSelect.replaceChildren();
  for (let world = 1; world <= 8; world++) {
    const group = document.createElement("optgroup");
    group.label = `世界 ${world}`;
    for (let course = 1; course <= 4; course++) {
      const stage = `${world}-${course}`,
        option = document.createElement("option");
      option.value = stage;
      const title =
        course === 4
          ? world === 8
            ? "最终城堡"
            : "城堡"
          : ["2-2", "7-2"].includes(stage)
            ? "水下"
            : ["1-2", "4-2"].includes(stage)
              ? "地下"
              : course === 3
                ? "高台"
                : "地上";
      option.textContent = `${stage} ${title}${stage === "1-1" ? " · 连续闯关" : ""}`;
      group.append(option);
    }
    courseSelect.append(group);
  }
  const colors = ["#ff705e", "#73df95", "#ffd66e", "#9eb6ff"];
  const keyState = new Set();
  const pressedActions = new Set();
  const touchState = new Map();
  const readStorage = (store, key) => {
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  };
  const writeStorage = (store, key, value) => {
    try {
      store.setItem(key, value);
    } catch {}
  };
  let socket, me, token, code, room, coopGame, scene, latestState, latestLevel;
  let localMode = false,
    localGame = null,
    localPaused = false,
    predictor = null;
  let simulationAt = 0,
    simulationAccumulator = 0,
    lastFrameSent = 0;
  const outgoingFrames = [];
  const predictedJumpSounds = new Set();
  let round = 0,
    installedRound = -1,
    assetsReady = false,
    intentional = false,
    connecting = false,
    reconnectAt = 0,
    retry = 0,
    seq = 0;
  let muted = readStorage(localStorage, "coop-muted") === "true";
  let seenEvent = 0,
    lastHud = 0,
    soloAuto = false,
    hallLoading = false,
    hallSignature = "";
  const viewId = (state) => state?.activePlayerId || me;
  $("nickname").value = readStorage(localStorage, "coop-name") || "玩家";
  $("mute-button").textContent = muted ? "声音关" : "声音开";
  $("mute-button").setAttribute("aria-pressed", String(muted));
  const incomingCode = new URL(location.href).searchParams.get("room");
  if (incomingCode)
    $("room-code").value = incomingCode
      .toUpperCase()
      .replace(/[^A-Z2-9]/g, "")
      .slice(0, 6);

  function status(message, ok = false) {
    $("status").textContent = message;
    $("status").classList.toggle("ok", ok);
  }
  function busy(value) {
    connecting = value;
    $("create-room").disabled = value;
    $("join-room").disabled = value;
    $("quick-join").disabled = value;
    $("classic-mode").disabled = value;
    $("local-turns").disabled = value;
  }
  function send(message) {
    if (localMode) {
      if (message.type === "again") beginLocalRound();
      if (message.type === "next-cycle" && localGame?.nextCycle()) {
        latestLevel = localGame.level;
        latestState = {
          ...localGame.snapshot(),
          receivedAt: performance.now(),
        };
        round = `local:${latestState.revision}`;
        resetInput();
        seenEvent = 0;
        simulationAt = 0;
        $("touch-controls").hidden = !matchMedia("(pointer:coarse)").matches;
        if (scene) scene.installLevel(latestLevel, round);
      }
      return;
    }
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  }
  function resetInput() {
    keyState.clear();
    pressedActions.clear();
    touchState.clear();
    document
      .querySelectorAll("[data-control]")
      .forEach((b) => b.classList.remove("pressed"));
  }
  function input() {
    const controls = [...touchState.values()];
    const left =
      keyState.has("KeyA") ||
      keyState.has("ArrowLeft") ||
      controls.includes("left");
    const right =
      keyState.has("KeyD") ||
      keyState.has("ArrowRight") ||
      controls.includes("right");
    return {
      type: "input",

      axis: Number(right) - Number(left),
      jump:
        pressedActions.has("jump") ||
        keyState.has("Space") ||
        keyState.has("KeyW") ||
        keyState.has("ArrowUp") ||
        controls.includes("jump"),
      fire:
        pressedActions.has("fire") ||
        keyState.has("KeyQ") ||
        keyState.has("KeyF") ||
        controls.includes("fire"),
      down:
        keyState.has("KeyS") ||
        keyState.has("ArrowDown") ||
        controls.includes("down"),
      run:
        keyState.has("ShiftLeft") ||
        keyState.has("ShiftRight") ||
        controls.length > 0,
    };
  }
  function renderRoom() {
    if (localMode) {
      if (assetsReady && !localGame) beginLocalRound();
      return;
    }
    if (!room) return;
    $("entry-panel").hidden = true;
    $("lobby").querySelector(".lobby-card").classList.add("in-room");
    $("room-panel").hidden = false;
    $("room-label").textContent = room.code;
    $("room-meta").textContent =
      `${room.mode === "turns" ? "双人轮换" : room.mode === "solo" ? "单人挑战" : "同时合作"} · ${room.visibility === "private" ? "私密房间" : "公开房间"} · ${room.stage} 起点 · ${room.players.length}/${room.maxPlayers} 人`;
    const list = $("players");
    list.replaceChildren();
    room.players.forEach((p) => {
      const li = document.createElement("li");
      const mark = document.createElement("span");
      mark.className = "seat-mark";
      mark.style.background = colors[p.slot];
      const name = document.createElement("span");
      name.className = "player-name";
      name.textContent = `${p.name}${p.id === me ? "（你）" : ""}${p.id === room.hostId ? " · 房主" : ""}`;
      const state = document.createElement("span");
      state.className = p.ready && p.connected ? "player-ready" : "player-wait";
      state.textContent = !p.connected
        ? "等待重连"
        : p.ready
          ? "已准备"
          : "未准备";
      li.append(mark, name, state);
      list.append(li);
    });
    const self = room.players.find((p) => p.id === me);
    const online = room.players.filter((p) => p.connected);
    $("ready-button").textContent = !assetsReady
      ? "游戏资源加载中…"
      : self?.ready
        ? "取消准备"
        : "准备";
    $("ready-button").disabled = !assetsReady;
    $("start-button").hidden = room.hostId !== me;
    $("start-button").disabled =
      online.length < (room.mode === "solo" ? 1 : 2) ||
      online.some((p) => !p.ready);
    $("room-help").textContent =
      online.length < (room.mode === "solo" ? 1 : 2)
        ? "复制邀请链接，等至少一位朋友加入。"
        : online.some((p) => !p.ready)
          ? "所有在线玩家准备后，房主即可开始。"
          : "全员已准备，房主可以开始闯关。";
    if (
      soloAuto &&
      assetsReady &&
      room.mode === "solo" &&
      room.phase === "lobby"
    ) {
      soloAuto = false;
      send({ type: "ready", ready: true });
      send({ type: "start" });
    }
  }

  async function refreshHall() {
    if (room || hallLoading) return;
    hallLoading = true;
    $("refresh-hall").disabled = true;
    try {
      const response = await fetch(new URL("api/lobby", location.href), {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("大厅暂时无法连接");
      const data = await response.json();
      $("hall-count").textContent =
        `${data.online} 人在线 · ${data.rooms.length} 个公开房间`;
      const signature = JSON.stringify(data.rooms);
      if (signature === hallSignature) return;
      hallSignature = signature;
      const list = $("public-rooms");
      list.replaceChildren();
      for (const r of data.rooms.sort(
        (a, b) => Number(b.joinable) - Number(a.joinable),
      )) {
        const row = document.createElement("div");
        row.className = "public-room";
        const details = document.createElement("div"),
          title = document.createElement("strong"),
          info = document.createElement("p");
        title.textContent = r.title;
        info.textContent = `${r.mode === "turns" ? "双人轮换" : "同时合作"} · ${r.players}/${r.maxPlayers} 人 · ${r.stage} · ${r.joinable ? "等待队友" : r.phase === "lobby" ? "房间已满" : "闯关中"}`;
        const button = document.createElement("button");
        button.className = "small";
        button.textContent = r.joinable
          ? "加入"
          : r.phase === "lobby"
            ? "已满"
            : "进行中";
        button.disabled = !r.joinable;
        button.addEventListener("click", () => connect("join", r.code));
        details.append(title, info);
        row.append(details, button);
        list.append(row);
      }
      if (!data.rooms.length) {
        const empty = document.createElement("p");
        empty.className = "hall-empty";
        empty.textContent = "还没有公开房间。创建一个，等朋友来冒险。";
        list.append(empty);
      }
    } catch {
      $("hall-count").textContent = "大厅连接失败，点击刷新重试。";
    } finally {
      hallLoading = false;
      $("refresh-hall").disabled = false;
    }
  }
  $("refresh-hall").addEventListener("click", refreshHall);
  refreshHall();
  setInterval(refreshHall, 5000);

  function connect(mode, requestedCode = "", resumeToken = null, solo = false) {
    if (
      connecting ||
      (socket &&
        [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState))
    )
      return;
    busy(true);
    intentional = false;
    const name = $("nickname").value.trim().slice(0, 16) || "玩家";
    writeStorage(localStorage, "coop-name", name);
    status(resumeToken ? "正在恢复房间连接…" : "正在连接房间…");
    const endpoint = new URL("ws", location.href);
    endpoint.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(endpoint);
    socket = ws;
    ws.addEventListener("open", () =>
      send({
        type: "hello",
        mode,
        code: requestedCode,
        token: resumeToken,
        name,
        solo,
        playMode: $("play-mode").value,
        protocol: MarioRuntime.INPUT_PROTOCOL,
        visibility: $("room-visibility").value,
        stage: $("stage-choice").value,
      }),
    );
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "welcome") {
        me = message.id;
        token = message.token;
        code = message.code;
        retry = 0;
        reconnectAt = 0;
        seq = 0;
        outgoingFrames.length = 0;
        predictor = null;
        simulationAccumulator = 0;
        simulationAt = 0;
        busy(false);
        status(
          message.resumed ? "连接已恢复。" : "房间已连接，邀请朋友一起加入。",
          true,
        );
        $("connection-state").textContent = "已连接";
        writeStorage(
          sessionStorage,
          "coop-session",
          JSON.stringify({ code, token }),
        );
        const url = new URL(location.href);
        url.searchParams.set("room", code);
        history.replaceState(null, "", url);
        bootCoop();
      } else if (message.type === "room") {
        room = message;
        renderRoom();
        if (message.phase === "lobby") {
          $("lobby").hidden = false;
          $("game-toolbar").hidden = true;
          $("round-message").hidden = true;
          $("touch-controls").hidden = true;
          latestState = null;
          resetInput();
          if (scene?.music) scene.music.stop();
        }
      } else if (message.type === "start") {
        latestLevel = message.level;
        round = `${message.round}:${message.revision}`;
        latestState = null;
        predictor = new MarioRuntime.PlayerPredictor(latestLevel, me);
        outgoingFrames.length = 0;
        simulationAccumulator = 0;
        simulationAt = 0;
        $("pause-button").hidden = true;
        $("lobby").hidden = true;
        $("game-toolbar").hidden = false;
        $("touch-controls").hidden = !matchMedia("(pointer:coarse)").matches;
        resetInput();
        seenEvent = 0;
        if (scene) scene.installLevel(latestLevel, round);
      } else if (message.type === "state") {
        const now = performance.now();
        latestState = { ...message, receivedAt: now };
        predictor?.reconcile(message, now);
      } else if (message.type === "pong") {
        $("connection-state").textContent =
          `已连接 · ${Math.max(0, Date.now() - message.at)} ms`;
      } else if (message.type === "error") {
        status(message.message);
        busy(false);
        if (message.message.includes("重连席位")) {
          token = null;
          writeStorage(sessionStorage, "coop-session", "");
        }
      }
    });
    ws.addEventListener("close", (event) => {
      if (socket !== ws) return;
      busy(false);
      resetInput();
      predictor = null;
      outgoingFrames.length = 0;
      if (intentional) return;
      $("connection-state").textContent = "连接已断开";
      if (event.code === 1008 || !token || !code) {
        if (room && latestState) {
          $("round-message").hidden = false;
          $("round-title").textContent = "连接已中断";
          $("round-detail").textContent = "请退出房间后重新加入。";
          $("again-button").hidden = true;
        }
        if (!$("status").textContent || $("status").classList.contains("ok"))
          status("无法连接房间，请检查网络后重试。");
        return;
      }
      if (!reconnectAt) reconnectAt = Date.now();
      if (Date.now() - reconnectAt >= 43000) {
        status("重连超时，请退出后重新加入房间。");
        return;
      }
      $("connection-state").textContent = "网络中断，正在重连…";
      status("网络中断，席位会保留45秒，正在自动重连…");
      setTimeout(
        () => connect("join", code, token),
        Math.min(500 * 2 ** retry++, 3000),
      );
    });
    ws.addEventListener("error", () => {});
  }

  function leave() {
    intentional = true;
    send({ type: "leave" });
    socket?.close();
    writeStorage(sessionStorage, "coop-session", "");
    const url = new URL(location.href);
    url.searchParams.delete("room");
    location.assign(url.pathname);
  }
  $("create-room").addEventListener("click", () => connect("create"));
  $("play-mode").addEventListener("change", () => {
    const turns = $("play-mode").value === "turns";
    $("create-room-label").textContent = turns
      ? "创建双人房间"
      : "创建合作房间";
    $("create-room-capacity").textContent = turns ? "2 人" : "2–4 人";
  });
  $("quick-join").addEventListener("click", () => connect("quick"));
  $("join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    connect("join", $("room-code").value.trim().toUpperCase());
  });
  $("room-code").addEventListener("input", (event) => {
    event.target.value = event.target.value
      .toUpperCase()
      .replace(/[^A-Z2-9]/g, "");
  });
  $("ready-button").addEventListener("click", () => {
    const self = room?.players.find((p) => p.id === me);
    send({ type: "ready", ready: !self?.ready });
  });
  $("start-button").addEventListener("click", () => send({ type: "start" }));
  $("world-select-button").addEventListener("click", leave);
  $("again-button").addEventListener("click", () => send({ type: "again" }));
  $("next-cycle-button").addEventListener("click", () =>
    send({ type: "next-cycle" }),
  );
  $("leave-lobby").addEventListener("click", leave);
  $("leave-game").addEventListener("click", leave);
  $("copy-invite").addEventListener("click", async () => {
    const url = new URL(location.href);
    url.searchParams.set("room", code);
    try {
      await navigator.clipboard.writeText(url.href);
      status("邀请链接已复制，发给朋友即可加入。", true);
    } catch {
      status(`房间码：${code}。可以复制浏览器地址栏发送给朋友。`, true);
    }
  });
  $("mute-button").addEventListener("click", () => {
    muted = !muted;
    writeStorage(localStorage, "coop-muted", String(muted));
    $("mute-button").textContent = muted ? "声音关" : "声音开";
    $("mute-button").setAttribute("aria-pressed", String(muted));
    if (scene) scene.sound.mute = muted;
  });
  function beginLocalRound() {
    localGame = MarioRuntime.createLocalGame(room.stage, 1, room.mode);
    latestLevel = localGame.level;
    round = `local:${Date.now()}`;
    latestState = { ...localGame.snapshot(), receivedAt: performance.now() };
    installedRound = -1;
    seenEvent = 0;
    simulationAt = 0;
    simulationAccumulator = 0;
    localPaused = false;
    resetInput();
    $("lobby").hidden = true;
    $("game-toolbar").hidden = false;
    $("pause-button").hidden = false;
    $("pause-button").textContent = "暂停";
    $("touch-controls").hidden = !matchMedia("(pointer:coarse)").matches;
    $("connection-state").textContent =
      room.mode === "turns" ? "双人轮换 · 本地运行" : "单人 · 本地运行";
    if (scene) scene.installLevel(latestLevel, round);
  }
  function togglePause(force) {
    if (
      !localMode ||
      !localGame ||
      ["won", "lost"].includes(latestState?.phase)
    )
      return;
    localPaused = typeof force === "boolean" ? force : !localPaused;
    simulationAt = 0;
    simulationAccumulator = 0;
    resetInput();
    $("pause-button").textContent = localPaused ? "继续" : "暂停";
    if (localPaused) scene?.music?.pause();
    else scene?.music?.resume();
    if (scene) {
      scene.time.paused = localPaused;
      if (localPaused) scene.tweens.pauseAll();
      else scene.tweens.resumeAll();
    }
    renderHud(latestState);
  }
  $("pause-button").addEventListener("click", () => togglePause());
  function beginLocal(mode) {
    if (connecting || socket?.readyState === WebSocket.OPEN) return;
    localMode = true;
    me = "local";
    localGame = null;
    predictor = null;
    const name = $("nickname").value.trim().slice(0, 16) || "玩家";
    writeStorage(localStorage, "coop-name", name);
    room = {
      mode,
      stage: $("stage-choice").value,
      hostId: me,
      players: [{ id: me, name, slot: 0, connected: true, ready: true }],
    };
    if (mode === "turns")
      room.players.push({
        id: "local2",
        name: "玩家 2",
        slot: 1,
        connected: true,
        ready: true,
      });
    busy(true);
    status("正在准备游戏资源…");
    bootCoop();
    if (assetsReady) beginLocalRound();
  }
  $("classic-mode").addEventListener("click", () => beginLocal("solo"));
  $("local-turns").addEventListener("click", () => beginLocal("turns"));
  $("random-mode").addEventListener("click", () => {
    $("lobby").hidden = true;
    $("game").hidden = false;
    $("back-classic").hidden = false;
    startClassicGame();
  });
  $("back-classic").addEventListener("click", () =>
    location.assign(location.pathname),
  );
  document.addEventListener("keydown", (event) => {
    if (localMode && ["KeyP", "Escape"].includes(event.code) && !event.repeat) {
      event.preventDefault();
      togglePause();
      return;
    }
    if (event.code === "KeyB" && latestState?.phase === "won") {
      leave();
      return;
    }
    if (
      !$("game-toolbar").hidden &&
      [
        "KeyA",
        "KeyD",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "KeyW",
        "ArrowUp",
        "KeyQ",
        "KeyF",
        "KeyS",
        "ArrowDown",
        "ShiftLeft",
        "ShiftRight",
      ].includes(event.code)
    ) {
      event.preventDefault();
      if (!event.repeat && ["Space", "KeyW", "ArrowUp"].includes(event.code))
        pressedActions.add("jump");
      if (!event.repeat && ["KeyQ", "KeyF"].includes(event.code))
        pressedActions.add("fire");
      keyState.add(event.code);
    }
  });
  document.addEventListener("keyup", (event) => keyState.delete(event.code));
  window.addEventListener("blur", () => {
    resetInput();
    if (localMode) togglePause(true);
    else flushControls(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      resetInput();
      if (localMode) togglePause(true);
      else flushControls(true);
    }
  });
  for (const button of document.querySelectorAll("[data-control]")) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      touchState.set(event.pointerId, button.dataset.control);
      if (["jump", "fire"].includes(button.dataset.control))
        pressedActions.add(button.dataset.control);
      button.classList.add("pressed");
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(type, (event) => {
        touchState.delete(event.pointerId);
        button.classList.remove("pressed");
      });
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  }
  function flushControls(neutralize = false) {
    if (localMode || socket?.readyState !== WebSocket.OPEN) return;
    if (neutralize) outgoingFrames.push({ ...input(), seq: ++seq });
    if (outgoingFrames.length) {
      send({ type: "input-frames", frames: outgoingFrames.splice(0, 6) });
      lastFrameSent = performance.now();
    }
  }
  function advanceSimulation(now) {
    if (!simulationAt) simulationAt = now;
    const elapsed = Math.min(100, Math.max(0, now - simulationAt));
    simulationAt = now;
    if (localMode && localPaused) {
      simulationAccumulator = 0;
      return;
    }
    simulationAccumulator += elapsed;
    for (
      let steps = 0;
      simulationAccumulator >= 1000 / 60 && steps < 6;
      steps++
    ) {
      simulationAccumulator -= 1000 / 60;
      const control = input();
      pressedActions.clear();
      if (localMode && localGame) {
        const revision = localGame.world.revision;
        latestState = { ...localGame.step(control), receivedAt: now };
        if (localGame.world.revision !== revision) {
          latestLevel = localGame.level;
          round = `local:${latestState.revision}`;
          seenEvent = 0;
          resetInput();
        }
      } else if (
        latestState?.phase === "playing" &&
        socket?.readyState === WebSocket.OPEN
      ) {
        const command = { ...control, seq: ++seq };
        predictor?.step(command, now);
        for (const effect of predictor?.effects.splice(0) || []) {
          if (effect.type === "jump") {
            predictedJumpSounds.add(effect.seq);
            if (predictedJumpSounds.size > 128)
              predictedJumpSounds.delete(
                predictedJumpSounds.values().next().value,
              );
            if (scene && !muted)
              scene.sound.play("coop-jump", { volume: 0.25 });
          }
        }
        outgoingFrames.push(command);
        if (outgoingFrames.length >= 2) flushControls();
      }
    }
    if (outgoingFrames.length && now - lastFrameSent > 30) flushControls();
  }
  setInterval(() => {
    if (me && !localMode) send({ type: "ping", at: Date.now() });
  }, 2500);

  // RENDERER
  function bootCoop() {
    if (coopGame) return;
    $("coop-game").hidden = false;
    class CoopScene extends Phaser.Scene {
      constructor() {
        super("cooperation");
      }
      preload() {
        window.MarioAssets.configureLoader(this.load);
        const images = {
          ground: "scenery/overworld/floorbricks.png",
          brick: "blocks/overworld/block.png",
          empty: "blocks/overworld/emptyBlock.png",
          stone: "blocks/overworld/immovableBlock.png",
          pipe: "scenery/vertical-small-tube.png",
          "pipe-side": "scenery/horizontal-tube.png",
          flagpole: "scenery/flag-mast.png",
          flag: "scenery/final-flag.png",
          castle: "scenery/castle.png",
          cloud: "scenery/overworld/cloud1.png",
          hill: "scenery/overworld/mountain2.png",
          bush: "scenery/overworld/bush1.png",
          mushroom: "collectibles/super-mushroom.png",
          oneup: "collectibles/live-mushroom.png",
        };
        for (const key of ["ground", "brick", "empty", "stone"])
          images[`${key}-under`] = images[key].replace(
            "overworld",
            "underground",
          );
        for (const key of [
          "stone-castle",
          "floor-castle",
          "castle-block",
          "bridge",
          "platform",
          "tree-left",
          "tree-middle",
          "tree-right",
          "tree-trunk",
          "lava",
          "toad",
          "bowser-fire",
        ])
          images[key] = `first-world/${key}.png`;
        Object.entries(images).forEach(([key, value]) =>
          this.load.image(`coop-${key}`, `assets/${value}`),
        );
        for (const [key, file, w, h] of [
          ["small", "entities/mario.png", 18, 16],
          ["big", "entities/mario-grown.png", 18, 32],
          ["fire", "entities/mario-fire.png", 18, 32],
          ["goomba", "entities/overworld/goomba.png", 16, 16],
          ["goomba-under", "entities/underground/goomba.png", 16, 16],
          ["koopa", "entities/koopa.png", 16, 24],
          ["shell", "entities/shell.png", 16, 15],
          ["coin", "collectibles/coin.png", 16, 16],
          ["question", "blocks/overworld/misteryBlock.png", 16, 16],
          ["question-under", "blocks/underground/misteryBlock.png", 16, 16],
          ["flower", "collectibles/overworld/fire-flower.png", 16, 16],
          ["flower-under", "collectibles/underground/fire-flower.png", 16, 16],
          ["bullet", "entities/fireball.png", 8, 8],
          ["bowser", "first-world/bowser.png", 32, 32],
          ["piranha", "first-world/piranha.png", 16, 24],
          ["star", "first-world/star.png", 16, 14],
          ["axe", "first-world/axe.png", 16, 16],
          ["koopa-winged", "first-world/koopa-winged.png", 16, 24],
          ["koopa-red", "first-world/koopa-red.png", 16, 24],
          ["koopa-winged-red", "first-world/koopa-winged-red.png", 16, 24],
          ["shell-red", "first-world/shell-red.png", 16, 14],
        ])
          this.load.spritesheet(`coop-${key}`, `assets/${file}`, {
            frameWidth: w,
            frameHeight: h,
          });
        for (const [key, file] of Object.entries({
          jump: "effects/jump.mp3",
          coin: "effects/coin.mp3",
          bump: "effects/block-bump.wav",
          break: "effects/break-block.wav",
          appear: "effects/powerup-appears.mp3",
          powerup: "effects/consume-powerup.mp3",
          hurt: "effects/powerdown.mp3",
          stomp: "effects/goomba-stomp.wav",
          kick: "effects/kick.mp3",
          fire: "effects/fireball.mp3",
          pipe: "effects/powerdown.mp3",
          win: "music/win.wav",
          die: "music/gameover.mp3",
        }))
          this.load.audio(`coop-${key}`, `assets/sound/${file}`);
        this.load.audio("coop-music", "assets/sound/music/overworld/theme.mp3");
        this.load.audio(
          "coop-underground",
          "assets/sound/music/underground/theme.mp3",
        );
        this.load.audio("coop-castle-music", "assets/first-world/castle.mp3");
        this.load.audio("coop-star-music", "assets/first-world/star.mp3");
        this.load.audio("coop-oneup", "assets/first-world/oneup.mp3");
        this.load.audio("coop-bridge", "assets/first-world/bridge.mp3");
        for (const sheet of window.MarioCampaignAssets)
          this.load.spritesheet(
            `coop-campaign-${sheet.name}`,
            `assets/campaign/${sheet.name}.png`,
            { frameWidth: sheet.width, frameHeight: sheet.height },
          );
        for (const name of [
          "underwater",
          "sky",
          "flagpole",
          "stageclear",
          "worldclear",
          "firework",
          "ending",
          "pipe",
          "vine",
          "die",
        ])
          this.load.audio(
            `coop-original-${name}`,
            `assets/campaign/${name}.mp3`,
          );
        this.load.on("progress", (value) => {
          if (!$("lobby").hidden)
            status(`正在准备游戏资源 ${Math.round(value * 100)}%…`);
        });
        this.load.on("loaderror", () => {
          this.failed = true;
          status("部分游戏资源加载失败，请刷新页面重试。");
        });
      }
      create() {
        scene = this;
        this.sound.mute = muted;
        this.scale.on("resize", this.resizeCamera, this);
        assetsReady = !this.failed;
        renderRoom();
        if (assetsReady) status("游戏资源已准备好，可以点击准备。", true);
        if (latestLevel) this.installLevel(latestLevel, round);
      }
      resizeCamera() {
        const width = this.scale.width,
          height = this.scale.height,
          zoom = Math.min(height / 240, width / 320);
        const padding = Math.max(0, (height / zoom - 240) / 2);
        this.cameras.main.setViewport(0, 0, width, height).setZoom(zoom);
        if (this.level)
          this.cameras.main.setBounds(
            0,
            -padding,
            this.level.width,
            240 + padding * 2,
          );
      }
      musicFor(key) {
        if (this.musicKey === key) return;
        this.music?.stop();
        this.music?.destroy();
        this.musicKey = key;
        this.music = this.sound.add(key, { loop: true, volume: 0.16 });
        this.music.play();
      }
      installLevel(bundle, currentRound) {
        const own = latestState?.players.find(
            (p) => p[0] === viewId(latestState),
          ),
          zone = own?.[11] || 0;
        const level = bundle.zones?.[zone] || bundle,
          key = `${currentRound}:${bundle.stage}:${zone}`;
        if (installedRound === key && this.level) return;
        installedRound = key;
        this.level = level;
        this.zone = zone;
        this.children.removeAll(true);
        this.actors = new Map();
        this.enemies = new Map();
        this.items = new Map();
        this.bullets = new Map();
        this.flames = new Map();
        this.hammers = new Map();
        this.vines = new Map();
        this.ropes = new Map();
        this.bubbles = new Map();
        this.tiles = new Map();
        this.coins = new Map();
        this.movers = new Map();
        this.firebars = [];
        this.cameras.main
          .setBackgroundColor(
            level.underwater
              ? "#5c94fc"
              : /Night|Underworld|Castle/.test(level.setting)
                ? "#080808"
                : "#5c94fc",
          )
          .setBounds(0, 0, level.width, level.height);
        this.underground = level.setting.includes("Underworld");
        this.castle = level.setting.includes("Castle");
        this.underwater = level.underwater;
        this.sky = level.sky;
        for (const d of level.decorations || []) {
          if (d.type === "trunk" || d.type === "shroom-trunk")
            this.add
              .tileSprite(
                d.x,
                d.y,
                d.w,
                d.h,
                d.type === "trunk"
                  ? "coop-tree-trunk"
                  : "coop-campaign-shroom-trunk",
              )
              .setOrigin(0)
              .setDepth(0);
          if (d.type === "railing")
            this.add
              .tileSprite(d.x, d.y, d.w, d.h, "coop-campaign-railing")
              .setOrigin(0)
              .setDepth(1);
          if (d.type === "source-scenery") {
            const meta = window.MarioCampaignAssets.find(
              (s) => s.name === d.sprite,
            );
            this.add
              .tileSprite(
                d.x,
                d.y,
                d.w || meta.width,
                d.h || meta.height,
                `coop-campaign-${d.sprite}`,
              )
              .setOrigin(0)
              .setDepth(0);
          }
          if (d.type === "scale-string")
            this.add
              .rectangle(d.x, d.y, d.w, 1, 0xffffff)
              .setOrigin(0)
              .setDepth(1);
          if (d.type === "castle")
            this.add
              .image(d.x, d.y, "coop-castle")
              .setOrigin(0.5, 1)
              .setScale(d.large ? 1.4 : 1)
              .setDepth(2);
          if (d.type === "toad" || d.type === "peach")
            this.add
              .image(
                d.x,
                d.y,
                d.type === "peach" ? "coop-campaign-peach" : "coop-toad",
              )
              .setOrigin(0)
              .setDepth(2);
          if (d.type === "warp")
            this.add
              .text(d.x, d.y, String(d.world), {
                fontFamily: "monospace",
                fontSize: "8px",
                color: "#fff",
              })
              .setOrigin(0.5, 1)
              .setResolution(3);
          if (d.type === "warp-welcome")
            this.add
              .text(d.x, d.y, "WELCOME TO WARP WORLD!", {
                fontFamily: "monospace",
                fontSize: "8px",
                color: "#fff",
              })
              .setOrigin(0.5, 1)
              .setResolution(3);
        }
        if (level.entryVine) {
          const v = level.entryVine;
          this.add
            .tileSprite(v.x * 2, v.y, v.w, v.h, "coop-campaign-vine-body")
            .setOrigin(0)
            .setDepth(1);
        }
        if (this.underwater) {
          this.add
            .rectangle(0, 24, level.width, 8, 0xaaaaff, 0.7)
            .setOrigin(0)
            .setDepth(0);
          for (let x = 0; x < level.width; x += 16)
            this.add.rectangle(x, 24, 8, 2, 0xffffff).setOrigin(0).setDepth(0);
        }
        for (const t of level.platforms) {
          let image;
          if (t.type === "tree" || t.type === "shroom") {
            const tree =
              t.type === "shroom" ? "coop-campaign-shroom" : "coop-tree";
            image = this.add.container(t.x, t.y);
            image.add(this.add.image(0, 0, `${tree}-left`).setOrigin(0));
            if (t.w > 32)
              image.add(
                this.add
                  .tileSprite(16, 0, t.w - 32, 16, `${tree}-middle`)
                  .setOrigin(0),
              );
            image.add(
              this.add.image(t.w - 16, 0, `${tree}-right`).setOrigin(0),
            );
          } else if (t.type === "cannon") {
            image = this.add.container(t.x, t.y);
            image.add(
              this.add.image(0, 0, "coop-campaign-cannon-top").setOrigin(0),
            );
            if (t.h > 16)
              image.add(
                this.add
                  .tileSprite(0, 16, t.w, t.h - 16, "coop-campaign-cannon-body")
                  .setOrigin(0),
              );
          } else if (t.type === "spring") {
            image = this.add.container(t.x, t.y);
            image.add(
              this.add
                .tileSprite(0, 0, 16, 21, "coop-campaign-spring-body")
                .setOrigin(0),
            );
            image.add(
              this.add.image(0, 21, "coop-campaign-spring-bottom").setOrigin(0),
            );
          } else if (["coral", "bridge-base", "shroom-trunk"].includes(t.type))
            image = this.add
              .tileSprite(t.x, t.y, t.w, t.h, `coop-campaign-${t.type}`)
              .setOrigin(0);
          else if (t.type === "question")
            image = this.add.sprite(
              t.x + 8,
              t.y + 8,
              `coop-question${this.underground ? "-under" : ""}`,
            );
          else if (t.type === "pipe" || t.type === "pipe-side")
            image = this.add
              .image(t.x, t.y, `coop-${t.type}`)
              .setOrigin(0)
              .setDisplaySize(t.w, t.h);
          else {
            const texture =
              t.type === "trunk"
                ? "tree-trunk"
                : t.type === "bridge"
                  ? "bridge"
                  : t.type === "castle-block"
                    ? "castle-block"
                    : this.castle
                      ? t.type === "ground"
                        ? "floor-castle"
                        : "stone-castle"
                      : `${t.type === "ground" ? "ground" : t.type === "brick" ? "brick" : "stone"}${this.underground ? "-under" : ""}`;
            image = this.add
              .tileSprite(t.x, t.y, t.w, t.h, `coop-${texture}`)
              .setOrigin(0);
          }
          image.setDepth(t.type === "trunk" ? 0 : 2).setVisible(!t.hidden);
          this.tiles.set(t.id, { image, tile: t });
        }
        for (const c of level.coins)
          this.coins.set(
            c.id,
            this.add.sprite(c.x, c.y, "coop-coin").setDepth(3),
          );
        for (const m of level.movers || []) {
          if (m.mode === "scale")
            this.ropes.set(
              m.id,
              this.add
                .rectangle(m.anchorX, m.anchorY, 1, m.y - m.anchorY, 0xffffff)
                .setOrigin(0)
                .setDepth(1),
            );
          this.movers.set(
            m.id,
            this.add
              .tileSprite(m.x, m.y, m.w, m.h, "coop-platform")
              .setOrigin(0)
              .setDepth(3),
          );
        }
        for (const h of level.hazards || []) {
          if (h.type === "water") {
            this.add
              .rectangle(h.x, h.y + 6, h.w, h.h, 0x2040d8)
              .setOrigin(0)
              .setDepth(1);
            this.add
              .rectangle(h.x, h.y, h.w, 6, 0x8898ff)
              .setOrigin(0)
              .setDepth(1);
          }
          if (h.type === "lava") {
            this.add
              .rectangle(h.x, h.y + 8, h.w, Math.max(16, h.h - 8), 0xd82800)
              .setOrigin(0);
            this.add
              .tileSprite(h.x, h.y, h.w, 11, "coop-lava")
              .setOrigin(0)
              .setDepth(2);
          }
          if (h.type === "firebar") {
            const sprites = Array.from({ length: h.count }, () =>
              this.add.sprite(h.x, h.y, "coop-bullet").setDepth(4),
            );
            this.firebars.push({ h, sprites });
          }
        }
        this.flag = null;
        this.axe = null;
        this.castleFlag = null;
        this.dialog = [];
        if (level.goal?.type === "flag") {
          this.add
            .image(level.goal.x, 208, "coop-flagpole")
            .setOrigin(0.5, 1)
            .setDepth(1);
          this.flag = this.add
            .image(level.goal.x - 1, 48, "coop-flag")
            .setOrigin(1, 0.5)
            .setDepth(2);
        }
        if (level.goal?.type === "flag") {
          this.castleFlag = this.add
            .image(
              level.goal.doorX,
              level.goal.groundY - (level.goal.large ? 112 : 80) + 20,
              "coop-campaign-castle-flag",
            )
            .setOrigin(0.5, 1)
            .setDepth(1)
            .setVisible(false);
        }
        if (["toad", "peach"].includes(level.goal?.type)) {
          const lines =
            level.goal.type === "peach"
              ? [
                  "THANK YOU MARIO!",
                  "YOUR QUEST IS OVER.\nWE PRESENT YOU A NEW QUEST.",
                  "PRESS BUTTON B\nTO SELECT A WORLD",
                ]
              : ["THANK YOU MARIO!", "BUT OUR PRINCESS IS IN\nANOTHER CASTLE!"];
          this.dialog = lines.map((text, i) =>
            this.add
              .text(level.goal.x + 24, 72 + i * 32, text, {
                fontFamily: "monospace",
                fontSize: "7px",
                color: "#fff",
                align: "center",
                lineSpacing: 7,
              })
              .setOrigin(0.5, 0)
              .setResolution(3)
              .setDepth(7)
              .setVisible(false),
          );
        }
        if (level.axe)
          this.axe = this.add
            .sprite(level.axe.x, level.axe.y, "coop-axe")
            .setOrigin(0)
            .setDepth(4);
        this.resizeCamera();
        this.musicKey = null;
        this.music?.stop();
        if (
          !latestState ||
          ["playing", "countdown"].includes(latestState.phase)
        )
          this.musicFor(this.themeKey());
        lastHud = 0;
      }
      themeKey() {
        return this.underwater
          ? "coop-original-underwater"
          : this.sky
            ? "coop-original-sky"
            : this.castle
              ? "coop-castle-music"
              : this.underground
                ? "coop-underground"
                : "coop-music";
      }
      update(time, delta) {
        advanceSimulation(performance.now());
        const state = latestState;
        if (!state || !latestLevel) return;
        this.installLevel(latestLevel, round);
        if (!this.level) return;
        if (localMode && localPaused) return;
        if (localMode) time = (state.tick * 1000) / 60;
        const blend = 1 - Math.exp(-Math.min(delta, 100) / 38),
          frame = Math.floor(time / 120),
          zone = this.zone;
        for (const [id, { image, tile }] of this.tiles) {
          image.setVisible(
            !state.broken.includes(id) &&
              (!tile.hidden || state.used.includes(id)),
          );
          if (state.used.includes(id))
            image.setTexture?.(`coop-empty${this.underground ? "-under" : ""}`);
          else if (tile.type === "question") image.setFrame(frame % 3);
        }
        for (const [id, image] of this.coins) {
          image.setVisible(!state.taken.includes(id));
          if (image.visible) image.setFrame(frame % 4);
        }
        for (const [id, x, y, z] of state.movers || []) {
          if (z === zone) {
            this.movers.get(id)?.setPosition(x, y);
            const m = this.level.movers.find((m) => m.id === id),
              rope = this.ropes.get(id);
            if (rope) rope.setDisplaySize(1, Math.max(1, y - m.anchorY));
          }
        }
        for (const { h, sprites } of this.firebars) {
          const angle =
            (state.tick +
              (localMode ? 0 : (performance.now() - state.receivedAt) * 0.06)) *
            0.025 *
            h.speed;
          sprites.forEach((s, i) =>
            s
              .setPosition(
                h.x + Math.cos(angle) * (i + 1) * 8,
                h.y + Math.sin(angle) * (i + 1) * 8,
              )
              .setFrame(frame % 4),
          );
        }
        if (this.axe)
          this.axe.setVisible(!state.bridgeOpened).setFrame(frame % 3);
        for (const [id, { image, tile }] of this.tiles)
          if (tile.type === "spring") {
            const compression =
              state.springs?.find((s) => s[0] === id)?.[1] || 0;
            image.setScale(1, 1 - compression * 0.35);
            image.y = tile.y + compression * 10;
          }
        const cinematic = state.cutscene;
        if (this.flag)
          this.flag.y =
            cinematic?.type === "flag"
              ? cinematic.flagY
              : this.level.goal.y + 9;
        if (this.castleFlag)
          this.castleFlag
            .setVisible(!!cinematic?.castleFlag)
            .setY(
              this.level.goal.groundY -
                (this.level.goal.large ? 112 : 80) +
                20 -
                (cinematic?.castleFlag || 0) * 14,
            );
        this.dialog.forEach((line, i) =>
          line.setVisible(
            cinematic?.type === "castle" && (cinematic.dialogLines || 0) > i,
          ),
        );
        const ids = new Set();
        const predicted = predictor?.row(performance.now());
        const renderPlayers = predicted
          ? state.players.map((p) => (p[0] === me ? predicted : p))
          : state.players;
        for (const p of renderPlayers) {
          const [
            id,
            x,
            y,
            vx,
            vy,
            form,
            facing,
            alive,
            invincible,
            lives,
            connected,
            pzone,
            star,
            crouch,
            pose,
            deathAge,
            bodyHeight,
            skidding,
          ] = p;
          if (pzone !== zone) continue;
          ids.add(id);
          const member = room?.players.find((m) => m.id === id);
          let a = this.actors.get(id);
          if (!a) {
            const sprite = this.add
                .sprite(x + 7, y + 16, "coop-small")
                .setOrigin(0.5, 1)
                .setDepth(5),
              label = this.add
                .text(
                  x,
                  y - 4,
                  `P${(member?.slot || 0) + 1}${id === me ? " · 你" : ""}`,
                  {
                    fontFamily: "system-ui",
                    fontSize: "7px",
                    color: colors[member?.slot || 0],
                    stroke: "#142444",
                    strokeThickness: 1,
                  },
                )
                .setResolution(3)
                .setOrigin(0.5, 1)
                .setDepth(6),
              marker = this.add
                .rectangle(
                  x,
                  y,
                  12,
                  2,
                  Phaser.Display.Color.HexStringToColor(
                    colors[member?.slot || 0],
                  ).color,
                )
                .setDepth(4);
            a = { sprite, label, marker };
            this.actors.set(id, a);
          }
          const s = a.sprite,
            death =
              !alive && deathAge >= 0 && deathAge < MarioRuntime.TIMING.respawn;
          let key = form === 2 ? "coop-fire" : form ? "coop-big" : "coop-small";
          let f = crouch
            ? 4
            : Math.abs(vy) > 8
              ? 5
              : Math.abs(vx) > 4.2
                ? [1, 2, 3, 2][
                    Math.floor(
                      (localGame?.world.tick ||
                        (id === me && predictor?.environment?.tick) ||
                        state.tick) /
                        (5 + Math.ceil(5.4 - Math.abs(vx) / 30)),
                    ) % 4
                  ]
                : 0;
          if (skidding && !crouch && pose !== "climb" && pose !== "swim") {
            key = `coop-campaign-player-skid-${form}`;
            f = 0;
          }
          if (pose === "climb") {
            key = `coop-campaign-player-climb-${form}`;
            f = frame % 2;
          } else if (pose === "swim") {
            key = `coop-campaign-player-swim-${form}`;
            f = frame % 3;
          } else if (death) {
            key = "coop-campaign-player-dead";
            f = 0;
          }
          const compact = alive && crouch && bodyHeight < 22;
          s.setTexture(key, f)
            .setScale(1, compact ? bodyHeight / 22 : 1)
            .setFlipX(facing < 0)
            .setVisible((Boolean(alive) && pose !== "hidden") || death)
            .setDepth(pose === "pipe" ? 1 : 5);
          const tx = x + 7,
            t = death ? Math.max(0, deathAge - 7) / 60 : 0,
            ty =
              y +
              (bodyHeight ?? (form && !crouch ? 32 : 16)) +
              (death ? -168 * t + 225 * t * t : 0);
          s.setPosition(
            localMode || (id === me && predicted) || Math.abs(s.x - tx) > 70
              ? tx
              : Phaser.Math.Linear(s.x, tx, blend),
            localMode || (id === me && predicted) || Math.abs(s.y - ty) > 70
              ? ty
              : Phaser.Math.Linear(s.y, ty, blend),
          );
          s.setAlpha(!connected ? 0.35 : invincible && frame % 2 ? 0.35 : 1);
          if (star)
            s.setTint([0xffff88, 0xff8877, 0x88ff99, 0x88ddff][frame % 4]);
          else s.clearTint();
          a.label
            .setPosition(s.x, s.y - (form && !crouch ? 35 : 19))
            .setVisible(Boolean(alive) && pose !== "hidden" && pose !== "pipe");
          a.marker
            .setPosition(s.x, s.y + 1)
            .setVisible(Boolean(alive) && pose !== "hidden" && pose !== "pipe");
        }
        for (const [id, a] of this.actors)
          if (!ids.has(id)) {
            a.sprite.destroy();
            a.label.destroy();
            a.marker.destroy();
            this.actors.delete(id);
          }
        this.updateEntities(
          this.enemies,
          state.enemies.filter((e) => e[7] === zone),
          (e) =>
            this.add.sprite(e[1], e[2], "coop-goomba").setOrigin(0).setDepth(4),
          (s, e) => {
            const type = e[5],
              shell = ["koopa", "beetle"].includes(type) && e[6] !== "walk";
            let key =
              type === "goomba"
                ? `coop-goomba${this.underground ? "-under" : ""}`
                : type === "koopa"
                  ? `coop-${shell ? (e[8] ? "shell-red" : "shell") : e[9] ? (e[8] ? "koopa-winged-red" : "koopa-winged") : e[8] ? "koopa-red" : "koopa"}`
                  : type === "bowser" || type === "piranha"
                    ? `coop-${type}`
                    : `coop-campaign-${type === "beetle" && shell ? "beetle-shell" : type === "cheep" && e[14] ? "cheep-red" : type === "blooper" && e[13] ? "blooper-squeeze" : type === "lakitu" && e[11] ? "lakitu-hiding" : type}`;
            let f =
              type === "bowser" || type === "hammerbro"
                ? (frame % 2) + (e[11] ? 2 : 0)
                : type === "goomba" && e[4]
                  ? 2
                  : shell ||
                      ["podoboo", "bill", "lakitu", "blooper"].includes(type)
                    ? 0
                    : frame % 2;
            if (type === "bowser" && e[4]) {
              const disguise =
                {
                  Goomba: "goomba",
                  Koopa: "koopa",
                  Beetle: "beetle",
                  Spiny: "spiny",
                  SpinyEgg: "spiny-egg",
                  Blooper: "blooper",
                  HammerBro: "hammerbro",
                  Bowser: "bowser",
                }[e[12]] || "goomba";
              key = ["goomba", "koopa", "bowser"].includes(disguise)
                ? `coop-${disguise}`
                : `coop-campaign-${disguise}`;
              f = 0;
            }
            s.setTexture(key, f)
              .setPosition(
                Phaser.Math.Linear(s.x, e[1], blend),
                Phaser.Math.Linear(s.y, e[2], blend),
              )
              .setFlipX(e[3] > 0)
              .setFlipY(e[16] === "flip" || (type === "podoboo" && e[15] > 0))
              .setAlpha(e[4] ? 0.65 : 1)
              .setDepth(type === "piranha" ? 1 : 4)
              .clearTint();
          },
        );
        this.updateEntities(
          this.items,
          state.items.filter((e) => e[4] === zone),
          ([, x, y]) =>
            this.add.sprite(x, y, "coop-mushroom").setOrigin(0).setDepth(4),
          (s, [, x, y, type]) => {
            const key =
              type === "flower" && this.underground ? "flower-under" : type;
            if (type === "coin") {
              s.setTexture("coop-coin", Math.floor(time / 75) % 4).setPosition(
                x,
                localMode ? y : Phaser.Math.Linear(s.y, y, blend),
              );
            } else {
              s.setTexture(
                `coop-${key}`,
                ["flower", "star"].includes(type) ? frame % 4 : 0,
              ).setPosition(x, y);
            }
          },
        );
        this.updateEntities(
          this.bullets,
          state.bullets.filter((e) => e[3] === zone),
          () => this.add.sprite(0, 0, "coop-bullet").setDepth(4),
          (s, e) => s.setPosition(e[1], e[2]).setFrame(frame % 4),
        );
        this.updateEntities(
          this.flames,
          (state.flames || []).filter((e) => e[3] === zone),
          () =>
            this.add.image(0, 0, "coop-bowser-fire").setOrigin(0).setDepth(4),
          (s, e) => s.setPosition(e[1], e[2]).setFlipX(e[4] > 0),
        );
        this.updateEntities(
          this.hammers,
          (state.hammers || []).filter((e) => e[3] === zone),
          () => this.add.sprite(0, 0, "coop-campaign-hammer").setDepth(4),
          (s, e) =>
            s.setPosition(e[1], e[2]).setFrame(Math.floor(time / 50) % 4),
        );
        this.updateEntities(
          this.vines,
          (state.vines || []).filter((e) => e[4] === zone),
          () =>
            this.add
              .tileSprite(0, 0, 14, 1, "coop-campaign-vine-body")
              .setOrigin(0)
              .setDepth(1),
          (s, e) => s.setPosition(e[1], e[2]).setSize(14, Math.max(1, e[3])),
        );
        if (this.underwater) {
          for (const p of state.players.filter((p) => p[11] === zone && p[7])) {
            const key = `${p[0]}:${Math.floor(state.tick / 96)}`;
            if (!this.bubbles.has(key)) {
              const bubble = this.add
                .image(p[1] + 7, p[2] + 4, "coop-campaign-bubble")
                .setDepth(5);
              this.bubbles.set(key, bubble);
              this.tweens.add({
                targets: bubble,
                y: 24,
                duration: 1800,
                onComplete: () => {
                  bubble.destroy();
                  this.bubbles.delete(key);
                },
              });
            }
          }
        }
        const self = this.actors.get(viewId(state));
        if (self) this.cameras.main.centerOn(self.sprite.x + 35, 120);

        const own = state.players.find((p) => p[0] === viewId(state));
        if (!localPaused && ["playing", "countdown"].includes(state.phase))
          this.musicFor(own?.[12] ? "coop-star-music" : this.themeKey());
        else {
          this.music?.stop();
          this.musicKey = null;
        }
        for (const event of state.events)
          if (event.id > seenEvent) {
            seenEvent = event.id;
            if (
              event.zone !== zone ||
              state.tick - (event.tick ?? state.tick) > 120
            )
              continue;
            if (event.type === "score" || event.type === "oneup") {
              const label = this.add
                .text(
                  event.x,
                  event.y - 12,
                  event.type === "oneup" ? "1UP" : String(event.value),
                  {
                    fontFamily: "monospace",
                    fontSize: "8px",
                    color: "#fff",
                    stroke: "#151515",
                    strokeThickness: 1,
                  },
                )
                .setOrigin(0.5, 1)
                .setResolution(3)
                .setDepth(7);
              this.tweens.add({
                targets: label,
                y: label.y - 24,
                alpha: 0,
                duration: 800,
                onComplete: () => label.destroy(),
              });
            }
            if (event.type === "bump") {
              const tile = [...this.tiles.values()].find(
                (t) => t.tile.x === event.x && t.tile.y === event.y,
              );
              if (tile)
                this.tweens.add({
                  targets: tile.image,
                  y: tile.image.y - 4,
                  yoyo: true,
                  duration: 90,
                });
            }
            if (event.type === "firework") {
              const explosion = this.add
                .sprite(event.x, event.y, "coop-campaign-firework", 0)
                .setDepth(8);
              for (let i = 1; i < 3; i++)
                this.time.delayedCall(
                  (i * 7 * 1000) / 60,
                  () => explosion.active && explosion.setFrame(i),
                );
              this.time.delayedCall((21 * 1000) / 60, () =>
                explosion.destroy(),
              );
            }
            const soundKey = this.cache.audio.exists(
              `coop-original-${event.type}`,
            )
              ? `coop-original-${event.type}`
              : event.type === "count"
                ? "coop-coin"
                : `coop-${event.type}`;
            if (
              !muted &&
              this.cache.audio.exists(soundKey) &&
              !(
                event.type === "jump" &&
                event.playerId === me &&
                predictedJumpSounds.has(event.inputSeq)
              ) &&
              (event.playerId === me ||
                !self ||
                Math.abs(event.x - self.sprite.x) < 350)
            )
              this.sound.play(soundKey, {
                volume: event.type === "win" ? 0.35 : 0.25,
              });
          }
        if (time - lastHud > 100) {
          renderHud(state);
          lastHud = time;
        }
      }
      updateEntities(map, entries, create, update) {
        const ids = new Set();
        for (const e of entries) {
          ids.add(e[0]);
          let s = map.get(e[0]);
          if (!s) {
            s = create(e);
            map.set(e[0], s);
          }
          update(s, e);
        }
        for (const [id, s] of map)
          if (!ids.has(id)) {
            s.destroy();
            map.delete(id);
          }
      }
    }
    coopGame = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "coop-game",
      backgroundColor: "#5c94fc",
      pixelArt: true,
      antialias: false,
      roundPixels: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: innerWidth,
        height: innerHeight,
      },
      scene: CoopScene,
      input: { keyboard: false },
      audio: { disableWebAudio: false },
      fps: { target: 60, forceSetTimeOut: false },
    });
  }
  function renderHud(state) {
    const cycle = state.cycle || 1;
    $("stage-label").textContent =
      `${scene?.level?.title || state.stage}${cycle > 1 ? ` · 第 ${cycle} 周目` : ""}`;
    $("team-score").textContent =
      `${state.activePlayerId ? "当前得分" : "团队分数"} ${String(state.score).padStart(6, "0")}`;
    $("team-coins").textContent = `金币 ${state.coins}`;
    $("game-time").textContent = `时间 ${state.time}`;
    const own = state.players.find((p) => p[0] === me);
    $("team-members").textContent = state.players
      .map((p) => {
        const member = room?.players.find((m) => m.id === p[0]);
        return `${member?.name || "玩家"}${p[0] === me ? "（你）" : ""} · ${p[9]}条命${!p[10] ? " · 重连中" : !p[7] ? (p[9] > 0 ? " · 复活中" : " · 观战") : p[11] !== own?.[11] ? " · 其他区域" : ""}`;
      })
      .join("　");
    if (state.standings) {
      $("team-members").textContent = state.standings
        .map((p) => {
          const member = room?.players.find((m) => m.id === p.id);
          return `${member?.name || `玩家 ${p.slot + 1}`}${p.id === state.activePlayerId ? " · 当前回合" : ""} · ${p.stage} · 第 ${p.cycle} 周目 · ${p.lives}条命 · ${p.coins}金币 · ${p.score}分${p.connected ? "" : " · 等待重连"}`;
        })
        .join("　");
    }
    $("next-cycle-button").hidden = true;
    if (localMode && localPaused) {
      $("round-message").hidden = false;
      $("round-message").classList.remove("completed");
      $("round-title").textContent = "已暂停";
      $("round-detail").textContent = "点击继续或按 P / Esc 返回游戏。";
      $("again-button").hidden = true;
      $("world-select-button").hidden = true;
      return;
    }
    const ending = ["won", "lost"].includes(state.phase),
      timedOut = state.phase === "timeout",
      turn = state.phase === "turn" || state.phase === "waiting",
      transition = ["cleared", "bridge", "rescue", "warp"].includes(
        state.phase,
      );
    $("round-message").hidden =
      state.phase !== "countdown" && !timedOut && !turn && !ending;
    $("round-message").classList.toggle("completed", state.phase === "won");
    if (ending) $("touch-controls").hidden = true;
    $("again-button").hidden = true;
    $("world-select-button").hidden = true;
    if (turn) {
      resetInput();
      const member = room?.players.find((p) => p.id === state.activePlayerId);
      $("round-title").textContent =
        state.phase === "waiting"
          ? "等待玩家重连"
          : state.turnPhase === "death"
            ? `${member?.name || "玩家"} 失误`
            : `轮到 ${member?.name || "下一位玩家"}`;
      $("round-detail").textContent =
        state.phase === "waiting"
          ? "当前回合已暂停。"
          : `${Math.max(1, state.countdown)} 秒后继续。`;
    } else if (timedOut) {
      resetInput();
      $("round-title").textContent = "时间到";
      $("round-detail").textContent =
        `${Math.max(1, state.countdown)} 秒后继续闯关。`;
    } else if (state.phase === "countdown") {
      $("round-title").textContent =
        `${state.activePlayerId ? `${room?.players.find((p) => p.id === state.activePlayerId)?.name || "玩家"} · ` : ""}WORLD ${state.stage} · ${Math.max(1, state.countdown)}`;
      $("round-detail").textContent = state.stage.endsWith("-4")
        ? "城堡：越过机关、触碰斧头，救援后将继续下一世界。"
        : scene?.underwater
          ? "水下：反复按跳跃游泳，向右进入出口水管。"
          : scene?.sky
            ? "天空奖励区：乘平台收集金币，落下即可回到地面。"
            : "连续闯关 · ↓ 入管，↑ / 跳跃游泳或爬藤，Shift 奔跑。";
    } else if (transition) resetInput();
    else if (ending) {
      resetInput();
      $("round-title").textContent =
        state.phase === "won"
          ? `第 ${cycle} 周目通关！`
          : state.time <= 0
            ? "时间到"
            : "再试一次吧";
      $("round-detail").textContent =
        state.phase === "won"
          ? `本轮得分 ${state.score}。可进入下一周目，或按 B 重新选择世界。`
          : `团队分数 ${state.score}，共收集 ${state.coins} 枚金币。`;
      $("again-button").hidden = room?.hostId !== me;
      $("again-button").textContent = localMode
        ? "重新挑战本关"
        : "返回房间，再来一局";
      $("world-select-button").hidden = state.phase !== "won";
      $("next-cycle-button").hidden =
        state.phase !== "won" ||
        cycle >= 99 ||
        (!localMode && room?.hostId !== me);
      $("next-cycle-button").textContent = `进入第 ${cycle + 1} 周目`;
    }
  }

  const saved = readStorage(sessionStorage, "coop-session");
  if (saved && incomingCode) {
    try {
      const session = JSON.parse(saved);
      if (session.code === incomingCode && session.token)
        connect("join", session.code, session.token);
    } catch {}
  }
})();
