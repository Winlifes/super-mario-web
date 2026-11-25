// Browser game timings and difficulty are authored here in 60 Hz simulation frames.
export const TIMING = Object.freeze({
  stageIntro: 150,
  respawn: 120,
  turnIntro: 90,
  hurtGrace: 150,
  spawnGrace: 180,
  pickupGrace: 45,
  portalCooldown: 90,
  portalGrace: 120,
  fireCooldown: 15,
});

export const CYCLE_RULES = Object.freeze({
  speedStep: 0.15,
  maximumSpeed: 1.6,
});

export const CHECKPOINT_RULES = Object.freeze({
  preferredFraction: 0.5,
  searchFraction: 0.2,
  clearanceHeight: 32,
  edgeMargin: 16,
  activationDistance: 64,
});

export function enemySpeed(cycle) {
  return Math.min(
    CYCLE_RULES.maximumSpeed,
    1 + (cycle - 1) * CYCLE_RULES.speedStep,
  );
}
