// Offline input search. Only control inputs drive the game; game state is never edited.
// Branching clones are a search optimisation, not a production game interface.
import { createWorld, addPlayer, stepWorld } from "../server/world.mjs";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
const stage = process.argv[2] || "2-2",
  beamSize = Number(process.env.ROUTE_BEAM || 70),
  horizon = Number(process.env.ROUTE_HORIZON || 8);
const initial = createWorld(1, { stage });
addPlayer(initial, "route", 0);
while (initial.phase === "countdown") stepWorld(initial);
function clone(w) {
  const copy = {
    ...w,
    players: new Map(
      [...w.players].map(([id, p]) => [
        id,
        { ...p, transit: p.transit ? { ...p.transit } : null },
      ]),
    ),
    events: [...w.events],
  };
  for (const key of [
    "enemies",
    "movers",
    "items",
    "bullets",
    "flames",
    "hammers",
    "vines",
  ])
    copy[key] = w[key].map((e) => ({ ...e }));
  for (const key of ["used", "broken", "taken"]) copy[key] = new Set(w[key]);
  copy.blockHits = new Map(w.blockHits);
  copy.triggerTicks = new Map(w.triggerTicks);
  copy.spawnFlags = new Map(w.spawnFlags);
  copy.cutscene = w.cutscene ? { ...w.cutscene } : null;
  return copy;
}
const hints = process.env.ROUTE_HINTS
  ? JSON.parse(readFileSync(process.env.ROUTE_HINTS))
  : [];
const actions = [];
for (const axis of [1, 0, -1])
  for (const jump of [false, true])
    actions.push({ axis, jump, run: true, fire: false, down: false });
actions.push(
  { axis: 1, jump: false, run: true, fire: false, down: true },
  { axis: 0, jump: false, run: true, fire: false, down: true },
);
const goalDistances = initial.level.zones.map((z) => (z.goal ? 0 : Infinity));
for (let i = 0; i < initial.level.zones.length + 1; i++)
  for (const z of initial.level.zones)
    for (const t of z.portals)
      if (Number.isInteger(t.target))
        goalDistances[z.zone] = Math.min(
          goalDistances[z.zone],
          1 + goalDistances[initial.level.locations[t.target].zone],
        );
function rank(w, hint = 0) {
  const p = w.players.get("route"),
    z = w.level.zones[p.zone];
  const exit = z.portals.find(
    (t) =>
      Number.isInteger(t.target) &&
      goalDistances[w.level.locations[t.target].zone] < goalDistances[p.zone],
  );
  const progress = exit
    ? -Math.abs(p.x - (exit.x - 12)) - Math.abs(p.y - (exit.y - 16)) * 0.5
    : p.x;
  const aim = hints[hint],
    hintScore =
      hint * 50000 -
      (aim && p.zone === (aim.zone || 0)
        ? Math.abs(p.x - aim.x) * 3 +
          Math.abs(p.y - aim.y) * 3 +
          (aim.maxSpeed ? Math.max(0, Math.abs(p.vx) - aim.maxSpeed) * 2 : 0)
        : 0);
  return (
    hintScore +
    (Number.isFinite(goalDistances[p.zone])
      ? (10 - goalDistances[p.zone]) * 10000
      : p.zone * 10000) +
    progress +
    (p.mazeSection || 0) * 4000 +
    (p.mazePassed ? 2000 : 0) +
    (p.form ? 25 : 0) +
    w.score * 0.002 -
    (p.y > 210 && !z.underwater ? (p.y - 210) * 8 : 0) +
    (p.transit ? 30 : 0) -
    w.tick * 0.012
  );
}
function key(w) {
  const p = w.players.get("route");
  return [
    p.zone,
    Math.round(p.x / 6),
    Math.round(p.y / 8),
    Math.round(p.vx / 35),
    Math.round(p.vy / 45),
    +p.lastJump,
    p.form,
    p.transit?.phase || "",
    p.climbing || "",
    p.mazePassed,
    w.used.size,
  ].join(":");
}
let rootPath = null,
  rootHint = 0;
if (process.env.ROUTE_PREFIX) {
  const prefix = JSON.parse(readFileSync(process.env.ROUTE_PREFIX));
  for (const action of prefix.route) {
    for (let i = 0; i < action.ticks; i++)
      stepWorld(initial, new Map([["route", action]]));
    rootPath = { previous: rootPath, action };
  }
  rootHint = prefix.hint || 0;
}
const routeOf = (path) => {
  const route = [];
  for (let p = path; p; p = p.previous) route.push(p.action);
  return route.reverse();
};
let beam = [{ w: initial, path: rootPath, hint: rootHint }],
  best = 0;
for (let iteration = 0; iteration < 650; iteration++) {
  const next = [],
    seen = new Set();
  for (const node of beam)
    for (const action of actions) {
      const w = clone(node.w);
      let ticks = 0;
      for (; ticks < horizon && w.phase === "playing"; ticks++)
        stepWorld(w, new Map([["route", action]]));
      const p = w.players.get("route");
      if (p.lives < 3 || !p.alive || w.phase === "lost") continue;
      const path = { previous: node.path, action: { ticks, ...action } };
      if (["cleared", "bridge", "won"].includes(w.phase)) {
        const route = [];
        for (let t = path; t; t = t.previous) route.push(t.action);
        route.reverse();
        const result = {
          stage,
          phase: w.phase,
          ticks: w.tick,
          x: p.x,
          zone: p.zone,
          lives: p.lives,
          score: w.score,
          route,
        };
        const filename = process.argv[3] || `docs/input-route-${stage}.json`;
        writeFileSync(filename, JSON.stringify(result, null, 2) + "\n");
        console.log(
          JSON.stringify({
            found: true,
            filename,
            ticks: w.tick,
            phase: w.phase,
            lives: p.lives,
            score: w.score,
          }),
        );
        process.exit(0);
      }
      if (w.phase !== "playing") continue;
      let hint = node.hint || 0;
      const aim = hints[hint];
      if (
        aim &&
        p.zone === (aim.zone || 0) &&
        Math.abs(p.x - aim.x) < (aim.dx || 20) &&
        Math.abs(p.y - aim.y) < (aim.dy || 24) &&
        (!aim.maxSpeed || Math.abs(p.vx) < aim.maxSpeed) &&
        (!aim.platformNear ||
          w.movers.some(
            (m) =>
              m.zone === p.zone &&
              Math.abs(m.x - aim.platformNear.x) < aim.platformNear.tolerance,
          )) &&
        (!aim.usedAt ||
          w.level.zones[p.zone].platforms.some(
            (t) =>
              t.x === aim.usedAt.x && t.y === aim.usedAt.y && w.used.has(t.id),
          ))
      )
        hint++;
      const k = hint + ":" + key(w);
      if (seen.has(k)) continue;
      seen.add(k);
      next.push({ w, path, hint, value: rank(w, hint) });
    }
  next.sort((a, b) => b.value - a.value);
  beam = next.slice(0, beamSize);
  if (!beam.length) break;
  if (iteration % 30 === 0) {
    const p = beam[0].w.players.get("route");
    if (process.env.ROUTE_PROGRESS) {
      mkdirSync(process.env.ROUTE_PROGRESS, { recursive: true });
      writeFileSync(
        `${process.env.ROUTE_PROGRESS}/${iteration}.json`,
        JSON.stringify({
          stage,
          hint: beam[0].hint,
          route: routeOf(beam[0].path),
        }),
      );
    }
    console.log(
      JSON.stringify({
        iteration,
        x: Math.round(p.x),
        y: Math.round(p.y),
        zone: p.zone,
        hint: beam[0].hint,
        value: Math.round(beam[0].value),
      }),
    );
  }
  const max = beam[0].value;
  if (max > best) best = max;
}
console.error(`No route found for ${stage}. Best rank ${best}.`);
process.exitCode = 1;
