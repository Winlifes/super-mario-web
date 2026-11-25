import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createGameServer } from "../server/index.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function client(base, hello) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", {
    origin: base,
  });
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "hello", ...hello }));
  return {
    ws,
    messages,
    send(value) {
      ws.send(JSON.stringify(value));
    },
    async wait(predicate, timeout = 5000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const message = messages.find(predicate);
        if (message) return message;
        await delay(10);
      }
      throw new Error("Timed out waiting for server message");
    },
  };
}

test(
  "four real WebSocket clients: capacity, readiness, shared state, stopped input, reconnect and host transfer",
  { timeout: 15000 },
  async (t) => {
    const app = createGameServer({ reconnectMs: 2000 });
    const address = await app.listen(0);
    const base = `http://127.0.0.1:${address.port}`;
    const clients = [];
    t.after(async () => {
      for (const c of clients) c.ws.terminate();
      await app.close();
    });
    const host = await client(base, { mode: "create", name: "host" });
    clients.push(host);
    const welcome = await host.wait((m) => m.type === "welcome");
    host.send({ type: "start" });
    await host.wait((m) => m.type === "error" && m.message.includes("至少2名"));
    for (let i = 1; i < 4; i++) {
      const c = await client(base, {
        mode: "join",
        code: welcome.code,
        name: `p${i}`,
      });
      clients.push(c);
      await c.wait((m) => m.type === "welcome");
    }
    const fifth = await client(base, {
      mode: "join",
      code: welcome.code,
      name: "fifth",
    });
    clients.push(fifth);
    await fifth.wait((m) => m.type === "error" && m.message.includes("4名"));
    assert.equal(app.rooms.get(welcome.code).players.size, 4);
    host.send({ type: "start" });
    await host.wait((m) => m.type === "error" && m.message.includes("准备"));
    for (const c of clients.slice(0, 4)) c.send({ type: "ready", ready: true });
    await host.wait(
      (m) =>
        m.type === "room" &&
        m.players.length === 4 &&
        m.players.every((p) => p.ready),
    );
    host.send({ type: "start" });
    for (const c of clients.slice(0, 4))
      await c.wait((m) => m.type === "start");
    const first = await host.wait(
      (m) => m.type === "state" && m.phase === "playing",
    );
    const matching = await clients[1].wait(
      (m) => m.type === "state" && m.tick === first.tick,
    );
    assert.deepEqual(first.players, matching.players);
    assert.deepEqual(first.enemies, matching.enemies);
    const room = app.rooms.get(welcome.code),
      actor = room.world.players.get(welcome.id),
      startX = actor.x;
    // Isolated transport fixture: combat must not respawn the actor during the stale-input check.
    room.world.enemies = [];
    let sequence = 0;
    const control = setInterval(
      () =>
        host.send({
          type: "input",
          seq: ++sequence,
          axis: 1,
          jump: false,
          run: false,
          fire: false,
          x: 999999,
          score: 999999,
        }),
      30,
    );
    let moved;
    try {
      moved = await host.wait(
        (m) => m.type === "state" && m.tick >= first.tick + 45,
      );
    } finally {
      clearInterval(control);
    }
    assert.ok(actor.x > startX + 12);
    assert.ok(
      actor.x <= startX + ((room.world.tick - first.tick) / 60) * 162 + 1,
    );
    assert.equal(room.world.score, 0);
    await host.wait(
      (m) =>
        m.type === "state" &&
        m.tick > moved.tick + 24 &&
        m.players.find((p) => p[0] === welcome.id)[3] === 0,
    );
    assert.equal(actor.vx, 0);
    const stopped = actor.x;
    await delay(300);
    assert.ok(Math.abs(actor.x - stopped) < 1);
    const secondWelcome = clients[1].messages.find((m) => m.type === "welcome");
    clients[1].ws.terminate();
    await delay(40);
    const resumed = await client(base, {
      mode: "join",
      code: welcome.code,
      token: secondWelcome.token,
    });
    clients.push(resumed);
    const resumedWelcome = await resumed.wait((m) => m.type === "welcome");
    assert.equal(resumedWelcome.id, secondWelcome.id);
    assert.equal(resumedWelcome.resumed, true);
    assert.equal(room.players.size, 4);
    assert.equal(room.world.players.size, 4);
    host.ws.terminate();
    await delay(50);
    assert.notEqual(room.hostId, welcome.id);
    const response = await fetch(base + "/api/health");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(
      (await fetch(base + "/%2eopenai/unused-sites-hosting.json")).status,
      404,
    );
  },
);

test(
  "a two-seat turn room hands over, spectates the same state and resumes the active seat",
  { timeout: 22000 },
  async (t) => {
    const app = createGameServer();
    const address = await app.listen(0);
    const base = `http://127.0.0.1:${address.port}`;
    const clients = [];
    t.after(async () => {
      for (const c of clients) c.ws.terminate();
      await app.close();
    });
    const host = await client(base, {
      mode: "create",
      playMode: "turns",
      protocol: 2,
    });
    clients.push(host);
    const first = await host.wait((m) => m.type === "welcome");
    const guest = await client(base, {
      mode: "join",
      code: first.code,
      protocol: 2,
    });
    clients.push(guest);
    const second = await guest.wait((m) => m.type === "welcome");
    const extra = await client(base, { mode: "join", code: first.code });
    clients.push(extra);
    await extra.wait((m) => m.type === "error" && m.message.includes("2名"));
    const lobby = await host.wait(
      (m) => m.type === "room" && m.players.length === 2,
    );
    assert.equal(lobby.mode, "turns");
    assert.equal(lobby.maxPlayers, 2);
    for (const c of [host, guest]) c.send({ type: "ready", ready: true });
    await host.wait(
      (m) => m.type === "room" && m.players.every((p) => p.ready),
    );
    host.send({ type: "start" });
    const initial = await host.wait(
      (m) => m.type === "state" && m.phase === "playing",
    );
    const spectator = await guest.wait(
      (m) => m.type === "state" && m.tick === initial.tick,
    );
    assert.equal(initial.activePlayerId, first.id);
    assert.ok(initial.prediction);
    assert.equal(spectator.prediction, undefined);
    assert.deepEqual(spectator.players, initial.players);
    assert.equal(initial.standings.length, 2);

    // A local server fixture reaches the death boundary, then the real tick loop hands over.
    const session = app.rooms.get(first.code).world;
    session.players.get(first.id).y = 280;
    const handoff = await guest.wait(
      (m) =>
        m.type === "state" &&
        m.phase === "playing" &&
        m.activePlayerId === second.id,
      10000,
    );
    assert.equal(handoff.players[0][0], second.id);
    assert.equal(handoff.standings.find((p) => p.id === first.id).lives, 2);
    assert.ok(handoff.prediction);
    guest.ws.terminate();
    await host.wait(
      (m) =>
        m.type === "state" &&
        m.phase === "waiting" &&
        m.activePlayerId === second.id,
    );
    const resumed = await client(base, {
      mode: "join",
      code: first.code,
      token: second.token,
      protocol: 2,
    });
    clients.push(resumed);
    const restored = await resumed.wait((m) => m.type === "welcome");
    assert.equal(restored.id, second.id);
    assert.equal(restored.resumed, true);
    const active = await resumed.wait(
      (m) => m.type === "state" && m.phase === "playing",
    );
    assert.equal(active.activePlayerId, second.id);
    assert.equal(active.standings.find((p) => p.id === first.id).lives, 2);
    resumed.send({ type: "leave" });
    await host.wait(
      (m) =>
        m.type === "state" &&
        m.activePlayerId === first.id &&
        m.standings.length === 1,
    );
  },
);

test("only a host can continue a completed room into its next cycle", async (t) => {
  const app = createGameServer();
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  const clients = [];
  t.after(async () => {
    for (const c of clients) c.ws.terminate();
    await app.close();
  });
  const host = await client(base, { mode: "create", stage: "8-4" });
  clients.push(host);
  const welcome = await host.wait((m) => m.type === "welcome");
  const guest = await client(base, { mode: "join", code: welcome.code });
  clients.push(guest);
  await guest.wait((m) => m.type === "welcome");
  for (const c of clients) c.send({ type: "ready", ready: true });
  await host.wait(
    (m) =>
      m.type === "room" &&
      m.players.length === 2 &&
      m.players.every((p) => p.ready),
  );
  host.send({ type: "start" });
  await host.wait((m) => m.type === "start");
  // Completion is a fixture here. The input replay test exercises the final course itself.
  const game = app.rooms.get(welcome.code).world;
  game.phase = "won";
  game.score = 5000;
  game.coins = 7;
  guest.send({ type: "next-cycle" });
  await delay(100);
  assert.equal(game.cycle, 1);
  host.send({ type: "next-cycle" });
  const next = await host.wait((m) => m.type === "state" && m.cycle === 2);
  assert.equal(next.stage, "1-1");
  assert.equal(next.phase, "countdown");
  assert.equal(next.score, 5000);
  assert.equal(next.coins, 7);
  const same = await guest.wait(
    (m) => m.type === "state" && m.tick === next.tick && m.cycle === 2,
  );
  assert.deepEqual(same.players, next.players);
});

test(
  "bad tokens and foreign WebSocket origins do not crash or join the server",
  { timeout: 5000 },
  async (t) => {
    const app = createGameServer();
    const address = await app.listen(0);
    const base = `http://127.0.0.1:${address.port}`;
    const host = await client(base, { mode: "create", name: "host" });
    t.after(async () => {
      host.ws.terminate();
      await app.close();
    });
    const welcome = await host.wait((m) => m.type === "welcome");
    const bad = await client(base, {
      mode: "join",
      code: welcome.code,
      token: "你".repeat(48),
    });
    await bad.wait((m) => m.type === "error");
    bad.ws.terminate();
    const foreign = new WebSocket(base.replace("http", "ws") + "/ws", {
      origin: "https://foreign.example",
    });
    foreign.on("error", () => {});
    const response = await new Promise((resolve) =>
      foreign.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response);
      }),
    );
    assert.equal(response.statusCode, 403);
    foreign.terminate();
    assert.equal((await fetch(base + "/api/health")).status, 200);
  },
);

test(
  "public lobby, private invites, quick join and solo stage selection use actual rooms",
  { timeout: 8000 },
  async (t) => {
    const app = createGameServer();
    const address = await app.listen(0),
      base = `http://127.0.0.1:${address.port}`,
      clients = [];
    t.after(async () => {
      for (const c of clients) c.ws.terminate();
      await app.close();
    });
    const open = await client(base, {
      mode: "create",
      name: "public",
      stage: "1-2",
    });
    clients.push(open);
    const a = await open.wait((m) => m.type === "welcome");
    const privateRoom = await client(base, {
      mode: "create",
      name: "private",
      visibility: "private",
    });
    clients.push(privateRoom);
    const b = await privateRoom.wait((m) => m.type === "welcome");
    let lobby = await (await fetch(base + "/api/lobby")).json();
    assert.equal(lobby.rooms.length, 1);
    assert.equal(lobby.rooms[0].code, a.code);
    assert.equal(lobby.rooms[0].stage, "1-2");
    assert.ok(!JSON.stringify(lobby).includes(a.token));
    assert.ok(!JSON.stringify(lobby).includes(b.code));
    const quick = await client(base, { mode: "quick", name: "quick" });
    clients.push(quick);
    assert.equal((await quick.wait((m) => m.type === "welcome")).code, a.code);
    const invited = await client(base, {
      mode: "join",
      code: b.code,
      name: "friend",
    });
    clients.push(invited);
    await invited.wait((m) => m.type === "welcome");
    const solo = await client(base, {
      mode: "create",
      solo: true,
      stage: "1-4",
      name: "solo",
    });
    clients.push(solo);
    const c = await solo.wait((m) => m.type === "welcome");
    solo.send({ type: "ready", ready: true });
    solo.send({ type: "start" });
    const start = await solo.wait((m) => m.type === "start");
    assert.equal(start.level.stage, "1-4");
    assert.equal(start.revision, 1);
    assert.equal(app.rooms.get(c.code).maxPlayers, 1);
    lobby = await (await fetch(base + "/api/lobby")).json();
    assert.equal(lobby.rooms.length, 1);
    assert.equal(lobby.rooms[0].players, 2);
    open.send({ type: "ready", ready: true });
    quick.send({ type: "ready", ready: true });
    await open.wait(
      (m) => m.type === "room" && m.players.every((p) => p.ready),
    );
    open.send({ type: "start" });
    await open.wait((m) => m.type === "start");
    lobby = await (await fetch(base + "/api/lobby")).json();
    assert.equal(lobby.rooms[0].joinable, false);
    // Isolated network fixture: trigger a stage boundary, then verify both sockets receive the same new stage.
    const world = app.rooms.get(a.code).world;
    world.phase = "cleared";
    const goal = world.level.zones.find((z) => z.goal).goal;
    world.cutscene = {
      type: "flag",
      phase: "fireworks",
      startedAt: world.tick - 500,
      phaseAt: world.tick - 420,
      playerId: app.rooms.get(a.code).hostId,
      zone: 3,
      goal,
      time: 0,
      fireworks: 0,
      fired: 0,
    };
    const next = await open.wait((m) => m.type === "start" && m.revision === 2);
    const peer = await quick.wait(
      (m) => m.type === "start" && m.revision === 2,
    );
    assert.equal(next.level.stage, "1-3");
    assert.deepEqual(peer.level, next.level);
  },
);

test(
  "a reconnect resets input sequence numbers so movement resumes immediately",
  { timeout: 6000 },
  async (t) => {
    const app = createGameServer();
    const address = await app.listen(0),
      base = `http://127.0.0.1:${address.port}`,
      clients = [];
    t.after(async () => {
      for (const c of clients) c.ws.terminate();
      await app.close();
    });
    const a = await client(base, { mode: "create", solo: true });
    clients.push(a);
    const hello = await a.wait((m) => m.type === "welcome");
    a.send({ type: "ready", ready: true });
    a.send({ type: "start" });
    await a.wait((m) => m.type === "start");
    a.send({
      type: "input",
      seq: 100,
      axis: 0,
      jump: false,
      run: false,
      fire: false,
    });
    await delay(40);
    a.ws.terminate();
    await delay(40);
    const b = await client(base, {
      mode: "join",
      code: hello.code,
      token: hello.token,
    });
    clients.push(b);
    await b.wait((m) => m.type === "welcome");
    b.send({
      type: "input",
      seq: 1,
      axis: 1,
      jump: false,
      run: false,
      fire: false,
    });
    await delay(40);
    const player = app.rooms.get(hello.code).players.get(hello.id);
    assert.equal(player.lastSeq, 1);
    assert.equal(player.input.axis, 1);
  },
);

test(
  "later-world cutscene snapshots and a mid-scene reconnect share one server timeline",
  { timeout: 7000 },
  async (t) => {
    const app = createGameServer(),
      address = await app.listen(0),
      base = `http://127.0.0.1:${address.port}`,
      clients = [];
    t.after(async () => {
      for (const c of clients) c.ws.terminate();
      await app.close();
    });
    const a = await client(base, {
      mode: "create",
      stage: "8-4",
      name: "host",
    });
    clients.push(a);
    const hello = await a.wait((m) => m.type === "welcome");
    for (let i = 0; i < 3; i++) {
      const b = await client(base, {
        mode: "join",
        code: hello.code,
        name: `peer${i}`,
      });
      clients.push(b);
      await b.wait((m) => m.type === "welcome");
    }
    for (const c of clients) c.send({ type: "ready", ready: true });
    await a.wait((m) => m.type === "room" && m.players.every((p) => p.ready));
    a.send({ type: "start" });
    for (const c of clients)
      assert.equal(
        (await c.wait((m) => m.type === "start")).level.stage,
        "8-4",
      );
    // Isolated transport test fixture. Normal-spawn input evidence is in input-replay.test.mjs.
    const world = app.rooms.get(hello.code).world,
      p = world.players.get(hello.id),
      z = world.level.zones.find((z) => z.axe);
    world.phase = "playing";
    p.zone = z.zone;
    p.x = z.axe.x;
    p.y = z.axe.y;
    const first = await a.wait(
      (m) =>
        m.type === "state" && m.phase === "bridge" && m.cutscene.removed > 0,
    );
    for (const c of clients.slice(1)) {
      const same = await c.wait(
        (m) => m.type === "state" && m.tick === first.tick,
      );
      assert.deepEqual(same.cutscene, first.cutscene);
      assert.deepEqual(same.broken, first.broken);
      assert.deepEqual(same.players, first.players);
    }
    const saved = clients[2].messages.find((m) => m.type === "welcome");
    clients[2].ws.terminate();
    await delay(30);
    const restored = await client(base, {
      mode: "join",
      code: hello.code,
      token: saved.token,
    });
    clients.push(restored);
    assert.equal(
      (await restored.wait((m) => m.type === "welcome")).resumed,
      true,
    );
    const resumed = await restored.wait(
      (m) => m.type === "state" && m.cutscene,
    );
    assert.equal(resumed.stage, "8-4");
    assert.equal(resumed.cutscene.startedAt, first.cutscene.startedAt);
    assert.ok(resumed.cutscene.removed >= first.cutscene.removed);
  },
);

test(
  "versioned input batches acknowledge simulated frames and expose no coordinate authority",
  { timeout: 6000 },
  async (t) => {
    const app = createGameServer(),
      address = await app.listen(0),
      base = `http://127.0.0.1:${address.port}`,
      clients = [];
    t.after(async () => {
      for (const c of clients) c.ws.terminate();
      await app.close();
    });
    const c = await client(base, { mode: "create", solo: true, protocol: 2 });
    clients.push(c);
    const hello = await c.wait((m) => m.type === "welcome");
    assert.equal(hello.protocol, 2);
    c.send({ type: "ready", ready: true });
    c.send({ type: "start" });
    const state = await c.wait(
      (m) =>
        m.type === "state" &&
        m.phase === "playing" &&
        m.prediction?.player.ground,
    );
    assert.equal(state.prediction.player.id, hello.id);
    assert.equal(state.prediction.protocol, 2);
    const frames = Array.from({ length: 6 }, (_, i) => ({
      seq: i + 1,
      axis: 1,
      jump: i === 0,
      fire: false,
      run: true,
      down: false,
      x: 999999,
    }));
    c.send({ type: "input-frames", frames });
    const ack = await c.wait(
      (m) => m.type === "state" && m.prediction?.ack === 6,
    );
    assert.ok(ack.players[0][1] < 100);
    assert.ok(ack.players[0][2] < 192);
    assert.ok(ack.tick >= state.tick + 6);
    assert.ok(Math.abs(ack.prediction.player.x - ack.players[0][1]) <= 0.051);
    const prior = c.messages.length;
    c.send({
      type: "input-frames",
      frames: [{ ...frames[0], seq: 7, axis: 100 }],
    });
    await delay(90);
    assert.ok(
      c.messages
        .slice(prior)
        .filter((m) => m.type === "state")
        .every((m) => m.prediction.ack === 6),
    );
    const token = hello.token;
    c.ws.terminate();
    await delay(30);
    const restored = await client(base, {
      mode: "join",
      code: hello.code,
      token,
      protocol: 2,
    });
    clients.push(restored);
    assert.equal(
      (await restored.wait((m) => m.type === "welcome")).resumed,
      true,
    );
    const reconnect = await restored.wait((m) => m.type === "state");
    assert.equal(reconnect.prediction.ack, -1);
    restored.send({
      type: "input-frames",
      frames: [
        { seq: 1, axis: -1, jump: false, fire: false, run: false, down: false },
      ],
    });
    await restored.wait((m) => m.type === "state" && m.prediction?.ack === 1);
  },
);
