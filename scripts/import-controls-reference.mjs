import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
const directory = process.argv[2] || "../mario-reference";
const source = readFileSync(`${directory}/Source/settings/math.js`, "utf8");
const context = { FullScreenMario: { FullScreenMario: { settings: {} } } };
runInNewContext(source, context, { timeout: 1000 });
const equation =
  context.FullScreenMario.FullScreenMario.settings.math.equations
    .decreasePlayerRunningXvel;
const scenarios = [
  { name: "walking", segments: [{ ticks: 90, axis: 1, run: false }] },
  {
    name: "running then releasing",
    segments: [
      { ticks: 45, axis: 1, run: true },
      { ticks: 100, axis: 0, run: false },
    ],
  },
  {
    name: "running then reversing",
    segments: [
      { ticks: 45, axis: 1, run: true },
      { ticks: 60, axis: -1, run: true },
    ],
  },
  {
    name: "water disables sprint",
    water: true,
    segments: [{ ticks: 90, axis: 1, run: true }],
  },
  {
    name: "crouching decelerates",
    segments: [
      { ticks: 45, axis: 1, run: true },
      { ticks: 60, axis: 1, run: true, crouch: true },
    ],
  },
];
for (const scenario of scenarios) {
  const p = {
    xvel: 0,
    moveleft: false,
    skidding: false,
    keys: { run: 0, sprint: false, leftDown: false, rightDown: false },
    FSM: { MapScreener: { underwater: !!scenario.water, nokeys: false } },
  };
  scenario.velocity = [];
  for (const segment of scenario.segments)
    for (let tick = 0; tick < segment.ticks; tick++) {
      p.keys.run = segment.axis;
      p.keys.sprint = segment.run;
      p.crouching = !!segment.crouch;
      equation({}, {}, p);
      p.xvel = Math.max(-5.4, Math.min(5.4, p.xvel));
      scenario.velocity.push(p.xvel * 30);
    }
}
writeFileSync(
  "docs/controls-reference-2026-11-24.json",
  JSON.stringify(
    {
      repository: "JFOC/FullScreenMario",
      revision: "dc7db1fdea151684d78425bd1152ff680c7047d6",
      file: "Source/settings/math.js",
      sha256: createHash("sha256").update(source).digest("hex"),
      function: "decreasePlayerRunningXvel",
      conversion:
        "Source velocity times 30 gives pixels per second in the 2 px, 60 Hz port; source maxspeed 5.4",
      scenarios,
    },
    null,
    2,
  ) + "\n",
);
