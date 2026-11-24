export const TILE = 16;
export const PLAYER_COLORS = ['#ff705e', '#73df95', '#ffd66e', '#9eb6ff'];

// A shared course for co-op. This is not advertised as a pixel-perfect original level.
export function makeLevel(seed = 1) {
  const platforms = [];
  let serial = 0;
  const add = (x, y, w, h, type = 'ground', content = null) => {
    const p = { id: `t${serial++}`, x, y, w, h, type };
    if (content) p.content = content;
    platforms.push(p);
    return p;
  };
  for (const [start, end] of [[0, 48], [51, 78], [82, 130], [133, 186], [190, 224]]) {
    add(start * TILE, 208, (end - start) * TILE, 32);
  }
  for (const [x, height] of [[28, 32], [43, 48], [67, 32], [112, 48], [161, 32]]) {
    add(x * TILE, 208 - height, 32, height, 'pipe');
  }
  for (const [start, y, types] of [
    [16, 144, 'b?b?b'], [35, 128, 'b?b'], [57, 144, '?bb?'],
    [72, 112, 'bbb'], [91, 144, 'b?b?b'], [103, 112, '?bb?'],
    [123, 144, 'b?b'], [145, 144, '?b?b?'], [173, 128, 'b?b?b'],
    [194, 144, 'b?b?b'],
  ]) {
    [...types].forEach((type, i) => {
      const content = type === '?' ? ((start + i + seed) % 3 === 0 ? 'flower' : (i % 2 ? 'mushroom' : 'coin')) : null;
      add((start + i) * TILE, y, TILE, TILE, type === '?' ? 'question' : 'brick', content);
    });
  }
  for (const [start, steps] of [[203, 4], [210, 4]]) {
    for (let i = 0; i < steps; i++) add((start + i) * TILE, 208 - (i + 1) * TILE, TILE, (i + 1) * TILE, 'stone');
  }
  const coins = [];
  for (const [start, y, count] of [[20, 173, 4], [36, 96, 3], [58, 112, 4], [73, 80, 3], [92, 112, 4], [104, 80, 4], [146, 112, 5], [174, 96, 4], [195, 112, 4]]) {
    for (let i = 0; i < count; i++) coins.push({ id: `c${coins.length}`, x: (start + i) * TILE + 8, y });
  }
  const enemies = [23, 37, 40, 60, 64, 88, 96, 108, 120, 141, 152, 169, 178, 197].map((x, i) => ({
    id: `e${i}`, x: x * TILE, y: 192, vx: i % 2 ? 26 : -26,
  }));
  return {
    id: 'coop-meadow', title: '合作草地', width: 224 * TILE, height: 240,
    platforms, coins, enemies, goal: { x: 217 * TILE, y: 40, groundY: 208 },
    checkpoints: [48, 1088, 2240, 3088],
  };
}

export function publicLevel(level) {
  return { ...level, platforms: level.platforms.map(({ content, ...p }) => p) };
}
