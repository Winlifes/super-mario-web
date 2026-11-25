export function emit(w, type, x, y, playerId = "", value = 0, zone = 0) {
  w.events.push({
    id: ++w.eventId,
    type,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    playerId,
    value,
    zone,
    tick: w.tick,
  });
  if (w.events.length > 64) w.events.shift();
}
