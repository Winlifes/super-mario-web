import { CHECKPOINT_RULES as rules } from "./rules.mjs";

const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function checkpointForZone(zone) {
  if (zone.sky || zone.setting.includes("Castle")) return null;
  const preferred = zone.width * rules.preferredFraction;
  const candidates = [];
  for (const floor of zone.platforms.filter((tile) => tile.type === "ground")) {
    const start = Math.ceil((floor.x + rules.edgeMargin) / 16) * 16;
    const end = floor.x + floor.w - rules.edgeMargin - 14;
    for (let x = start; x <= end; x += 16) {
      if (Math.abs(x - preferred) > zone.width * rules.searchFraction) continue;
      const body = {
        x,
        y: floor.y - rules.clearanceHeight,
        w: 14,
        h: rules.clearanceHeight,
      };
      if (zone.platforms.some((tile) => !tile.hidden && overlaps(body, tile)))
        continue;
      if (zone.hazards.some((hazard) => overlaps(body, hazard))) continue;
      candidates.push({ x, y: floor.y - 16 });
    }
  }
  return (
    candidates.sort(
      (a, b) => Math.abs(a.x - preferred) - Math.abs(b.x - preferred),
    )[0] || null
  );
}
