// Development verification: drives the real world using inputs only, from its normal spawn.
// Search nodes are private simulation copies; no teleport, invulnerability or production test API.
import { createWorld, addPlayer, stepWorld } from "../server/world.mjs";
import { writeFileSync } from "node:fs";
const stage = process.argv[2] || "1-1";
let world = createWorld(1, { stage });
addPlayer(world, "route", 0);
const idle = { axis: 0, jump: false, run: true, fire: false, down: false };
while (world.phase === "countdown") stepWorld(world);
const actions = [
  ...[-1, 0, 1].flatMap((axis) =>
    [false, true].map((jump) => ({ ...idle, axis, jump })),
  ),
  { ...idle, down: true },
  { ...idle, axis: 1, down: true },
];
const copy = (w) => {
  const { level, ...state } = w;
  return { ...structuredClone(state), level };
};
function progress(w) {
  const p = w.players.get("route");
  let base = 0;
  if (stage === "1-2")
    base = p.zone === 1 || p.zone === 2 ? 400 : p.zone === 3 ? 3500 : 0;
  return base + p.x;
}
function score(w, root) {
  const p = w.players.get("route");
  if (!p.alive || p.lives < root.players.get("route").lives) return -1e9;
  return ["cleared", "won"].includes(w.phase)
    ? 1e8
    : progress(w) +
        p.form * 20 -
        (w.tick - root.tick) * 0.03 +
        (p.ground ? 2 : 0);
}
const route = [],
  history = [];
let backtracks = 0;
let stagnant = 0,
  previous = 0;
for (
  let decision = 0;
  decision < 900 && ["playing", "bridge"].includes(world.phase);
  decision++
) {
  if (world.phase === "bridge") {
    route.push({ ticks: 120, ...idle });
    for (let i = 0; i < 120; i++) stepWorld(world, new Map([["route", idle]]));
    continue;
  }
  const index = route.length;
  history[index] ||= { w: copy(world), banned: new Set() };
  let beam = [{ w: copy(world), first: null }],
    best;
  for (let depth = 0; depth < 10; depth++) {
    const candidates = [],
      buckets = new Set();
    for (const node of beam)
      for (let a = 0; a < actions.length; a++) {
        if (depth === 0 && history[index].banned.has(a)) continue;
        const w = copy(node.w);
        for (let i = 0; i < 8; i++)
          stepWorld(w, new Map([["route", actions[a]]]));
        const value = score(w, world);
        if (value <= -1e8) continue;
        const p = w.players.get("route");
        const bucket = [
          p.zone,
          Math.round(p.x / 7),
          Math.round(p.y / 7),
          Math.round(p.vx / 25),
          Math.round(p.vy / 50),
          p.ground,
          p.lastJump,
          p.form,
        ].join(":");
        if (buckets.has(bucket)) continue;
        buckets.add(bucket);
        candidates.push({ w, value, first: node.first ?? a });
      }
    candidates.sort((a, b) => b.value - a.value);
    beam = candidates.slice(0, stage === "1-3" ? 24 : 10);
    if (!beam.length) {
      best = null;
      break;
    }
    best = beam[0];
    if (best.value > 1e7) break;
  }
  if (!best) {
    if (++backtracks > 40 || index < 1)
      throw new Error(
        `No surviving route: ${JSON.stringify(world.players.get("route"))}`,
      );
    let back = Math.max(0, index - 4);
    while (back > 0 && history[back].banned.size >= actions.length - 1) back--;
    history[back].banned.add(history[back].action);
    world = copy(history[back].w);
    route.length = back;
    history.length = back + 1;
    stagnant = 0;
    console.log(
      JSON.stringify({
        backtrack: backtracks,
        x: world.players.get("route").x,
      }),
    );
    continue;
  }
  history[index].action = best.first;
  const action = actions[best.first];
  route.push({ ticks: 8, ...action });
  for (let i = 0; i < 8; i++) stepWorld(world, new Map([["route", action]]));
  const progressNow = progress(world);
  stagnant = progressNow < previous + 1 ? stagnant + 1 : 0;
  previous = progressNow;
  if (decision % 50 === 0)
    console.log(
      JSON.stringify({
        decision,
        x: Math.round(world.players.get("route").x),
        zone: world.players.get("route").zone,
        phase: world.phase,
      }),
    );
  if (stagnant > 50)
    throw new Error(`Route stalled near x=${world.players.get("route").x}`);
}
const p = world.players.get("route");
const result = {
  stage,
  phase: world.phase,
  ticks: world.tick,
  x: p.x,
  zone: p.zone,
  lives: p.lives,
  score: world.score,
  route,
};
writeFileSync(
  new URL(`../docs/input-route-${stage}.json`, import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
if (!["cleared", "won"].includes(world.phase))
  throw new Error(`Did not complete ${stage}: ${world.phase}`);
console.log(JSON.stringify({ ...result, route: route.length }));
