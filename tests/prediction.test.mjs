import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  addPlayer,
  stepWorld,
  snapshot,
} from "../shared/world.mjs";
import {
  PlayerPredictor,
  acceptInputFrames,
  consumeInputFrame,
  INPUT_PROTOCOL,
} from "../shared/prediction.mjs";
const neutral = { axis: 0, jump: false, run: false, fire: false, down: false };
function packet(w, p, ack) {
  return JSON.parse(
    JSON.stringify({
      ...snapshot(w),
      prediction: {
        protocol: INPUT_PROTOCOL,
        ack,
        player: p,
        movers: w.movers,
      },
    }),
  );
}
function setup(stage = "1-1") {
  const w = createWorld(1, { stage }),
    p = addPlayer(w, "a", 0);
  w.phase = "playing";
  w.enemies = [];
  stepWorld(w);
  const predictor = new PlayerPredictor(w.level, "a");
  predictor.reconcile(packet(w, p, 0), 0);
  return { w, p, predictor };
}
test("prediction reacts before the network reply and reconciles pending controls over 200 ms RTT", () => {
  const { w, p, predictor } = setup();
  w.level.zones[0].platforms = [
    { id: "floor", type: "ground", x: 0, y: 208, w: 8000, h: 32 },
  ];
  w.level.zones[0].goal = null;
  predictor.level = w.level;
  predictor.reconcile(packet(w, p, 0), 0);
  const connection = {
      lastSeq: 0,
      appliedSeq: 0,
      inputQueue: [],
      input: neutral,
      inputAt: 0,
    },
    up = [],
    down = [];
  let movedBeforeReply = false,
    maxPending = 0,
    maxCorrection = 0;
  for (let i = 1; i <= 420; i++) {
    const now = (i * 1000) / 60,
      command = {
        ...neutral,
        axis: i < 155 ? 1 : i < 235 ? -1 : 0,
        run: true,
        jump: i >= 50 && i < 70,
        seq: i,
      };
    predictor.step(command, now);
    up.push({ due: i + 6, command });
    if (i === 1) movedBeforeReply = predictor.player.x > p.x;
    for (const event of up.filter((e) => e.due === i)) {
      assert.equal(acceptInputFrames(connection, [event.command]), true);
      connection.inputAt = now;
    }
    stepWorld(w, new Map([["a", consumeInputFrame(connection, now)]]));
    if (i % 3 === 0)
      down.push({ due: i + 6, state: packet(w, p, connection.appliedSeq) });
    for (const event of down.filter((e) => e.due === i)) {
      const old = { x: predictor.player.x, y: predictor.player.y };
      predictor.reconcile(event.state, now);
      maxCorrection = Math.max(
        maxCorrection,
        Math.hypot(old.x - predictor.player.x, old.y - predictor.player.y),
      );
    }
    maxPending = Math.max(maxPending, predictor.pending.length);
  }
  assert.ok(movedBeforeReply);
  assert.ok(maxPending >= 10 && maxPending <= 16);
  assert.ok(maxCorrection < 3, `correction ${maxCorrection}`);
  assert.ok(Math.abs(predictor.player.x - p.x) < 0.1);
  assert.ok(Math.abs(predictor.player.y - p.y) < 0.1);
});
test("a jump press and release in one packet are consumed on different simulation frames", () => {
  const { w, p } = setup();
  const q = {
    lastSeq: 0,
    appliedSeq: 0,
    inputQueue: [],
    input: neutral,
    inputAt: 0,
  };
  assert.ok(
    acceptInputFrames(q, [
      { ...neutral, jump: true, seq: 1 },
      { ...neutral, jump: false, seq: 2 },
    ]),
  );
  stepWorld(w, new Map([["a", consumeInputFrame(q, 1)]]));
  assert.ok(p.vy < 0);
  assert.equal(q.appliedSeq, 1);
  stepWorld(w, new Map([["a", consumeInputFrame(q, 2)]]));
  assert.equal(p.lastJump, false);
  assert.equal(q.appliedSeq, 2);
});
test("input flooding cannot advance server time and queues and stalled prediction are bounded", () => {
  const { w, predictor } = setup(),
    q = {
      lastSeq: 0,
      appliedSeq: 0,
      inputQueue: [],
      input: neutral,
      inputAt: 0,
    };
  let seq = 0;
  for (let batch = 0; batch < 25; batch++)
    assert.ok(
      acceptInputFrames(
        q,
        Array.from({ length: 6 }, () => ({ ...neutral, axis: 1, seq: ++seq })),
      ),
    );
  assert.equal(q.inputQueue.length, 24);
  const tick = w.tick;
  consumeInputFrame(q, 1);
  assert.equal(w.tick, tick);
  assert.equal(q.inputQueue.length, 23);
  assert.equal(acceptInputFrames(q, [{ ...neutral, seq }]), false);
  assert.equal(
    acceptInputFrames(q, [{ ...neutral, seq: seq + 1, axis: 9 }]),
    false,
  );
  consumeInputFrame(q, 500);
  assert.equal(q.inputQueue.length, 0);
  assert.equal(q.input.axis, 0);
  for (let i = 0; i < 200; i++)
    predictor.step({ ...neutral, axis: 1, seq: i }, i * 17);
  assert.ok(predictor.pending.length <= 24);
  assert.ok(predictor.environment.tick <= tick + 19);
});
test("zone changes, respawn and cutscenes discard obsolete prediction and accept authoritative state", () => {
  const { w, p, predictor } = setup();
  predictor.step({ ...neutral, axis: 1, seq: 1 }, 10);
  assert.ok(predictor.pending.length);
  p.zone = 1;
  p.x = 40;
  p.y = 16;
  p.transit = { phase: "enter", target: 0 };
  predictor.reconcile(packet(w, p, 0), 20);
  assert.equal(predictor.pending.length, 0);
  assert.equal(predictor.row(20), null);
  assert.equal(predictor.player.zone, 1);
  p.transit = null;
  p.zone = 0;
  p.x = 80;
  p.alive = true;
  w.tick++;
  predictor.reconcile(packet(w, p, 1), 30);
  predictor.step({ ...neutral, axis: 1, seq: 2 }, 40);
  p.alive = false;
  w.tick++;
  predictor.reconcile(packet(w, p, 1), 45);
  assert.equal(predictor.pending.length, 0);
  assert.equal(predictor.active, false);
  p.alive = true;
  w.phase = "cleared";
  w.tick++;
  predictor.reconcile(packet(w, p, 2), 50);
  assert.equal(predictor.row(50), null);
});
test("moving platform carry is shared by predicted and authoritative motion", () => {
  const { w, p, predictor } = setup("1-3"),
    m = w.movers.find((m) => m.mode === "horizontal");
  p.x = m.x + 8;
  p.y = m.y - 16;
  p.riding = m.id;
  p.ground = true;
  predictor.reconcile(packet(w, p, 0), 0);
  for (let i = 1; i < 20; i++) {
    const command = { ...neutral, seq: i };
    predictor.step(command, i * 16);
    stepWorld(w, new Map([["a", command]]));
    assert.ok(Math.abs(p.x - predictor.player.x) < 1e-9);
    assert.ok(Math.abs(p.y - predictor.player.y) < 1e-9);
    predictor.reconcile(packet(w, p, i), i * 16);
  }
});
