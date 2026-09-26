/**
 * แปลงแผนที่ตัวอักษร (content.js MAPS) เป็นข้อมูลที่เกมใช้ + การชนกำแพง
 *
 * **การชนต้องตรงกับ client/src/level/collision.ts ทุกตัวอักษร** — client ทำนายการเดินของตัวเองล่วงหน้า
 * ถ้ากฎต่างกัน ตัวละครจะเดินทะลุบนจอเราแล้วโดน server ดึงกลับตลอด
 *
 * ทุกอย่างที่โต้ตอบได้มี id คงที่ต่อแผนที่ (ลำดับตามการอ่านแผนที่ซ้าย→ขวา บน→ล่าง):
 *   p<n> แปลง   c<n> โต๊ะ/ชั้นเครื่องมือ   k<n> จุดแพ็ก   s<n> ร้าน   d<n> กล่องเมล็ด
 *   b<n> รถส่งออก   w<n> บ่อน้ำ   g<n> ถังขยะ   a<n> สัตว์ (H ไก่ / M วัว)   (ของบนพื้นเป็น i<uid> สร้างตอนเล่น)
 */
const TILE = 64;
const RADIUS = 14; // รัศมีตัวละครที่ใช้ชน — ต้องน้อยกว่า TILE/2 การเช็ค 4 มุมถึงจะพอ
const BLOCKING = new Set(['#', 'T', 'W', 'S', 'K', 'B', 'C', 'R', 'D', 'G', 'H', 'M']);
const ANIMAL_TILE = { H: 'chicken', M: 'cow' };
const STATION_PREFIX = { S: 's', D: 'd', B: 'b', W: 'w', G: 'g' };

function parseLevel(id, def, CROPS = {}) {
  const width = def.tiles[0].length;
  def.tiles.forEach((row, i) => {
    if (row.length !== width) throw new Error(`map ${id} row ${i} has ${row.length} cols, expected ${width}`);
  });

  const plots = [];
  const counters = []; // { id, x, y, rack }
  const packers = [];
  const stations = []; // { id, type: 'S'|'D'|'B'|'W'|'G', x, y }
  const spawns = [];
  const animals = []; // { id, type: 'chicken'|'cow', x, y }
  const n = { p: 0, c: 0, k: 0, s: 0, d: 0, b: 0, w: 0, g: 0, a: 0 };
  def.tiles.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      if (ch === 'P') plots.push({ id: `p${n.p++}`, x, y });
      else if (ch === 'C' || ch === 'R') counters.push({ id: `c${n.c++}`, x, y, rack: ch === 'R' });
      else if (ch === 'K') packers.push({ id: `k${n.k++}`, x, y });
      else if (ANIMAL_TILE[ch]) animals.push({ id: `a${n.a++}`, type: ANIMAL_TILE[ch], x, y });
      else if (STATION_PREFIX[ch]) {
        const pre = STATION_PREFIX[ch];
        stations.push({ id: `${pre}${n[pre]++}`, type: ch, x, y });
      } else if (ch === '@') spawns.push({ x, y });
    });
  });
  if (!spawns.length) throw new Error(`map ${id} has no spawn (@)`);
  const racks = counters.filter((c) => c.rack).length;
  if (racks < def.tools.length) throw new Error(`map ${id} has ${racks} racks for ${def.tools.length} tools`);
  checkReachable(id, def.tiles, spawns, [...plots, ...counters, ...packers, ...animals], stations);
  // ของจากสัตว์ที่มีในแผนที่นี้ — ออเดอร์สุ่มจาก crops + products
  const products = [...new Set(animals.map((a) => Object.values(CROPS).find((c) => c.animal === a.type)?.id).filter(Boolean))];

  return {
    id,
    name: def.name,
    theme: def.theme,
    crops: def.crops,
    products,
    growMul: def.growMul,
    walkMul: def.walkMul,
    stars: def.stars,
    tools: def.tools,
    tiles: def.tiles,
    tile: TILE,
    cols: width,
    rows: def.tiles.length,
    w: width * TILE,
    h: def.tiles.length * TILE,
    plots,
    counters,
    packers,
    animals,
    stations,
    spawns,
  };
}

/**
 * ทุกอย่างที่โต้ตอบได้ต้องมีช่องเดินได้ติดกัน (บน/ล่าง/ซ้าย/ขวา) ที่เดินไปถึงจากจุดเกิด — ไม่งั้นบูตไม่ขึ้น
 * (เคยมีโต๊ะในแผนที่หิมะที่ล้อมด้วยรถ/ต้นไม้/รั้ว เดินไปไม่ถึง แต่ร้านวางเครื่องมือที่ซื้อลงไปได้ = ของหาย)
 */
function checkReachable(id, tiles, spawns, things, stations) {
  const open = (c, r) => r >= 0 && c >= 0 && r < tiles.length && c < tiles[0].length && !BLOCKING.has(tiles[r][c]);
  const seen = new Set();
  const q = spawns.map((s) => [Math.floor(s.x / TILE), Math.floor(s.y / TILE)]);
  q.forEach(([c, r]) => seen.add(`${c},${r}`));
  while (q.length) {
    const [c, r] = q.shift();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c + dc},${r + dr}`;
      if (!seen.has(k) && open(c + dc, r + dr)) {
        seen.add(k);
        q.push([c + dc, r + dr]);
      }
    }
  }
  const reach = (t) => {
    const c = Math.floor(t.x / TILE);
    const r = Math.floor(t.y / TILE);
    return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => seen.has(`${c + dc},${r + dr}`));
  };
  // โต๊ะ/จุดแพ็ก/แปลง เก็บของแยกกันทีละช่อง → ต้องถึงทุกช่อง
  for (const t of things) {
    if (!reach(t)) throw new Error(`map ${id}: ${t.id} at (${t.x}, ${t.y}) cannot be reached from a spawn`);
  }
  // สถานีชนิดเดียวกันใช้แทนกันได้ (บ่อใหญ่ 2×2, รถ 2 ช่อง) → ขอแค่ถึงได้สักช่อง
  for (const type of new Set(stations.map((s) => s.type))) {
    if (!stations.filter((s) => s.type === type).some(reach)) throw new Error(`map ${id}: no reachable '${type}' tile`);
  }
}

function blockedAt(level, x, y) {
  const c = Math.floor(x / TILE);
  const r = Math.floor(y / TILE);
  if (r < 0 || c < 0 || r >= level.rows || c >= level.cols) return true;
  return BLOCKING.has(level.tiles[r][c]);
}

function collides(level, x, y) {
  return (
    blockedAt(level, x - RADIUS, y - RADIUS) ||
    blockedAt(level, x + RADIUS, y - RADIUS) ||
    blockedAt(level, x - RADIUS, y + RADIUS) ||
    blockedAt(level, x + RADIUS, y + RADIUS)
  );
}

const SUBSTEP = 4; // px — server ขยับทีละ ~22px ต่อ tick ส่วน client ~4px ต่อเฟรม ต้องซอยเท่ากันไม่งั้นชนกำแพงคนละจุด
const NUDGE = 20; // เยื้องจากช่องว่างไม่เกินนี้ ช่วยดันเข้าช่องให้ (corner correction แบบ Overcooked)

/**
 * ขยับแยกแกน x แล้ว y ทีละไม่เกิน SUBSTEP — ชนแกนไหนหยุดแค่แกนนั้น (ไถลเลียบกำแพงได้) และชนตรงๆ ทั้งที่
 * ข้างๆ มีช่องว่างอยู่ใกล้ๆ = เลื่อนข้างเข้าหาช่องเอง ไม่งั้นเยื้องกลางช่องเกิน 18px ก็เดินเข้าช่องแคบไม่ได้
 * (วัดแล้ว: จอยทำให้เยื้องแบบนี้ตลอด = "เดินติดมุม")
 */
function moveWithCollision(level, p, dx, dy) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / SUBSTEP));
  for (let i = 0; i < n; i++) stepOnce(level, p, dx / n, dy / n);
}

function stepOnce(level, p, dx, dy) {
  if (dx) {
    if (!collides(level, p.x + dx, p.y)) p.x += dx;
    else if (Math.abs(dy) < Math.abs(dx) * 0.5) nudge(level, p, 'x', dx);
  }
  if (dy) {
    if (!collides(level, p.x, p.y + dy)) p.y += dy;
    else if (Math.abs(dx) < Math.abs(dy) * 0.5) nudge(level, p, 'y', dy);
  }
}

/** ชนตามแกน axis — หาระยะเลื่อนข้างที่ใกล้สุด (≤ NUDGE) ที่จากตรงนั้นเดินต่อได้ แล้วเลื่อนเข้าหาทีละไม่เกินก้าว */
function nudge(level, p, axis, d) {
  for (let o = 1; o <= NUDGE; o++) {
    for (const s of [1, -1]) {
      const sx = axis === 'y' ? s * o : 0;
      const sy = axis === 'x' ? s * o : 0;
      const ahead = axis === 'x' ? collides(level, p.x + d, p.y + sy) : collides(level, p.x + sx, p.y + d);
      if (ahead || collides(level, p.x + sx, p.y + sy)) continue;
      const m = Math.min(Math.abs(d), o) * s;
      if (axis === 'x') p.y += m;
      else p.x += m;
      return;
    }
  }
}

module.exports = { parseLevel, moveWithCollision, collides, blockedAt, TILE };
