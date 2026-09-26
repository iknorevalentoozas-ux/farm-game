// บอทเล่นจริงผ่าน socket (ใช้วัดบาลานซ์) — หาทางด้วย BFS, ทำงานครบวงจร (ไถ/ปลูก/รด/เก็บ/แพ็ก/ส่ง), เก็บสถิติ
// รันกับ server ทดสอบที่แยกพอร์ต/ข้อมูลเสมอ:
//   FARM_DATA_DIR=/tmp/f PORT=5461 FARM_START_MAP=starter node src/index.js
//   node scripts/playbot.js http://localhost:5461 2 starter-2
// ผลเป็น JSON ตอนจบรอบ: คะแนน/ดาว/ส่งสำเร็จ/หมดเวลา, เวลาเหลือตอนส่ง, % เวลาว่าง, จุดที่เดินติด, toast ที่โดนปฏิเสธ
// บอทส่งแค่ทิศ (ไม่ส่ง x,y) → server ขยับให้เองแบบ intent
// node playbot.js <url> <nBots> <label> [roundLimitSec]
const { io } = require('socket.io-client');
const URL = process.argv[2];
const N = +process.argv[3];
const LABEL = process.argv[4] || 'run';
const TILE = 64;
const BLOCK = new Set(['#', 'T', 'W', 'S', 'K', 'B', 'C', 'R', 'D', 'G', 'H', 'M']);
const PRODUCT = { chicken: 'egg', cow: 'milk' };
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1);

const W = { level: null, state: null, orders: [], round: null, players: [], team: null };
const claims = new Map(); // targetId -> bot index
const stats = {
  toasts: {}, stuck: [], completed: [], expiredMsgs: 0, ordersSeen: new Map(), idleMs: Array(N).fill(0), busyMs: Array(N).fill(0),
  actions: {}, end: null, firstOrderDone: null,
};
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);

function walkable(c, r) {
  const L = W.level;
  if (r < 0 || c < 0 || r >= L.rows || c >= L.cols) return false;
  return !BLOCK.has(L.tiles[r][c]);
}
function bfs(from, goalFn) {
  const L = W.level;
  const start = [Math.floor(from.x / TILE), Math.floor(from.y / TILE)];
  const key = (c, r) => r * L.cols + c;
  const prev = new Map([[key(...start), null]]);
  const q = [start];
  while (q.length) {
    const [c, r] = q.shift();
    if (goalFn(c, r)) {
      const path = [];
      let k = key(c, r);
      while (k != null) {
        path.unshift([k % L.cols, Math.floor(k / L.cols)]);
        k = prev.get(k);
      }
      return path.map(([c, r]) => ({ x: c * TILE + 32, y: r * TILE + 32 }));
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (!walkable(nc, nr) || prev.has(key(nc, nr))) continue;
      prev.set(key(nc, nr), key(c, r));
      q.push([nc, nr]);
    }
  }
  return null;
}
const near = (t, maxD) => (c, r) => walkable(c, r) && Math.hypot(c * TILE + 32 - t.x, r * TILE + 32 - t.y) <= maxD;

const now = () => Date.now();
function plotStage(p, t = now()) {
  if (!p.crop) return -1;
  const prog = p.progressMs + Math.max(0, Math.min(t, p.moistUntil || 0) - W.state.serverNow);
  return prog >= p.growMs ? 3 : 0;
}
function demand() {
  // ต่อพืช: ต้องการอีกกี่กล่อง ลบของที่อยู่ในสายพานแล้ว
  const d = {};
  for (const o of W.orders) for (const [k, it] of Object.entries(o.items)) {
    const c = k.split(':')[1];
    d[c] = (d[c] || 0) + (it.need - it.have);
  }
  const pipe = (k) => { if (!k) return; const c = k.split(':')[1]; if (d[c] != null && !k.startsWith('tool:')) d[c] -= 1; };
  for (const p of W.state.plots) if (p.crop) d[p.crop] != null && (d[p.crop] -= 1);
  for (const c of W.state.counters) pipe(c.item?.k);
  for (const k of W.state.packers) pipe(k.item?.k);
  for (const g of W.state.ground) pipe(g.item?.k);
  for (const pl of W.players) pipe(pl.held?.k);
  for (const a of W.state.animals || []) if (a.fed) { const c = PRODUCT[W.level.animals.find((q) => q.id === a.id).type]; if (d[c] != null) d[c] -= 1; }
  return d;
}
const wantedBox = (k) => W.orders.some((o) => o.items[k] && o.items[k].have < o.items[k].need);

class Bot {
  constructor(i) {
    this.i = i;
    this.uuid = `bot-${LABEL}-${i}`;
    this.s = io(URL, { transports: ['websocket'], forceNew: true });
    this.plan = null;
    this.wait = 0;
    this.lastPos = null;
    this.stuckMs = 0;
    this.s.on('connect', () => this.s.emit('player:join', { uuid: this.uuid, name: `บอท${i + 1}` }));
    this.s.on('world:snapshot', (sn) => { if (i === 0) Object.assign(W, { level: sn.level, state: sn.state, orders: sn.orders, round: sn.round, team: sn.team, catalog: sn.catalog }); });
    this.s.on('round:start', (sn) => { if (i === 0) Object.assign(W, { level: sn.level, state: sn.state, orders: sn.orders, round: sn.round, team: sn.team, catalog: sn.catalog }); this.plan = null; });
    this.s.on('farm:toast', ({ text }) => {
      if (text.includes('ส่งออเดอร์ครบ')) return;
      if (i === 0 || !text.match(/หมดเวลา|ฝนตก|แมลง|ออเดอร์ด่วน|ซื้อ/)) bump(stats.toasts, text.replace(/\d+/g, '#'));
    });
    if (i === 0) {
      this.s.on('world:state', ({ players }) => (W.players = players));
      this.s.on('level:state', (st) => (W.state = st));
      this.s.on('farm:team', (t) => (W.team = t));
      this.s.on('round:update', (r) => (W.round = r));
      this.s.on('orders:list', ({ orders }) => {
        const ids = new Set(orders.map((o) => o.id));
        for (const o of orders) if (!stats.ordersSeen.has(o.id)) stats.ordersSeen.set(o.id, { ...o, spawnAt: now(), rel: ts(), qty: Object.values(o.items).reduce((a, b) => a + b.need, 0) });
        for (const o of W.orders) if (!ids.has(o.id)) {
          const seen = stats.ordersSeen.get(o.id);
          const done = Object.values(o.items).every((it) => it.have >= it.need) || now() < o.expiresAt - 300;
          if (done && now() < o.expiresAt - 300) {
            stats.completed.push({ id: o.id, qty: seen?.qty, total: o.totalSec, left: Math.round((o.expiresAt - now()) / 1000), rush: o.rush });
            if (!stats.firstOrderDone) stats.firstOrderDone = ts();
          }
        }
        W.orders = orders;
      });
      this.s.on('round:end', (r) => { stats.end = r; setTimeout(report, 300); });
    }
  }
  me() { return W.players.find((p) => p.uuid === this.uuid); }
  go(targetId, pos, action, extra = {}) {
    const me = this.me();
    const radius = extra.radius || 72;
    const path = bfs(me, near(pos, radius));
    if (!path) { bump(stats.toasts, `[bot] no path to ${targetId}`); return false; }
    if (targetId) claims.set(targetId, this.i);
    this.plan = { targetId, pos, action, path, ...extra, started: now() };
    if (process.env.BOT_TRACE) console.error(ts(), 'bot' + this.i, action, targetId || '', 'held=' + (me.held ? me.held.k + (me.held.n ? 'x' + me.held.n : '') : '-'));
    return true;
  }
  release() { if (this.plan?.targetId && claims.get(this.plan.targetId) === this.i) claims.delete(this.plan.targetId); this.plan = null; }
  free(id) { return !claims.has(id) || claims.get(id) === this.i; }

  tick(dt) {
    const me = this.me();
    if (!me || !W.state || W.round?.phase !== 'playing') return;
    if (me.work && me.work.until > now()) { this.stop(); stats.busyMs[this.i] += dt; this.wasWorking = true; return; }
    if (this.wasWorking) { this.wasWorking = false; this.wait = now() + 300; } // รอ level:state หลังงานเสร็จ
    if (this.wait > now()) { this.stop(); return; }
    if (!this.plan) this.decide(me);
    if (!this.plan) { this.stop(); stats.idleMs[this.i] += dt; return; }
    stats.busyMs[this.i] += dt;
    const p = this.plan;
    if (now() - p.started > 20000) { bump(stats.toasts, `[bot] plan timeout ${p.action}`); this.release(); return; }
    // เดินตามทาง
    while (p.path.length && Math.hypot(p.path[0].x - me.x, p.path[0].y - me.y) < 6) p.path.shift();
    if (p.path.length) {
      const wp = p.path[0];
      const dx = wp.x - me.x, dy = wp.y - me.y, d = Math.hypot(dx, dy);
      const m = Math.min(1, d / 44); // tick ของ server ยืดได้ถึง 250ms ตอนเครื่องหนัก — ครึ่งเดียวกันเลยจุด
      this.s.emit('player:move', { dx: (dx / d) * m, dy: (dy / d) * m });
      if (this.lastPos && Math.hypot(me.x - this.lastPos.x, me.y - this.lastPos.y) < 1) {
        this.stuckMs += dt;
        if (this.stuckMs > 800) {
          stats.stuck.push({ t: ts(), at: [Math.round(me.x), Math.round(me.y)], wp: [wp.x, wp.y], goal: p.action });
          this.stuckMs = 0;
          this.release();
        }
      } else this.stuckMs = 0;
      this.lastPos = { x: me.x, y: me.y };
      return;
    }
    // ถึงแล้ว
    this.stop();
    bump(stats.actions, p.action);
    if (p.action === 'seed') {
      this.s.emit('act:seed', { crop: p.crop });
    } else if (p.action === 'feed-bag') {
      this.s.emit('act:seed', { crop: 'feed' });
    } else if (p.action === 'drop') {
      this.s.emit('act:primary', {});
    } else if (p.action === 'use') {
      this.s.emit('act:use', { targetId: p.targetId });
    } else {
      this.s.emit('act:primary', { targetId: p.targetId });
    }
    this.wait = now() + 350; // รอ state อัปเดต
    this.release();
  }
  stop() { this.s.emit('player:move', { dx: 0, dy: 0 }); }

  decide(me) {
    const S = W.state, L = W.level;
    const h = me.held;
    const T = (list, pred) => list.filter(pred);
    const dist = (a) => Math.hypot(a.x - me.x, a.y - me.y);
    const closest = (arr) => arr.sort((a, b) => dist(a) - dist(b))[0];
    const lp = (id) => L.plots.find((p) => p.id === id);
    const plotsFull = S.plots.map((p) => ({ ...p, ...lp(p.id) }));
    const animalsFull = () => (S.animals || []).map((a) => ({ ...a, ...L.animals.find((q) => q.id === a.id) }));
    const counterPos = (id) => L.counters.find((c) => c.id === id);
    const station = (type) => L.stations.filter((s) => s.type === type);
    const t = now();

    // แมลง: ไล่ก่อน
    const pest = closest(T(plotsFull, (p) => p.pestUntil && this.free(p.id)));
    if (pest && dist(pest) < 400) return this.go(pest.id, pest, 'shoo');

    const freeCounter = () => closest(T(S.counters.map((c) => ({ ...c, ...counterPos(c.id) })), (c) => !c.item && this.free(c.id)));
    // โต๊ะเต็มหมด = วางพื้นตรงนั้นเลย (เดิมยืนถือค้างทั้งรอบ)
    const putDown = () => { const c = freeCounter(); if (c) return this.go(c.id, c, 'putdown'); return this.go(null, me, 'drop', { radius: 200 }); };
    const packerList = S.packers.map((x) => ({ ...x, ...L.packers.find((q) => q.id === x.id) }));

    if (h) {
      const k = h.k;
      if (k.startsWith('box:')) {
        if (wantedBox(k)) { const tr = closest(station('B')); return this.go(tr.id, tr, 'deliver'); }
        const shop = closest(station('S')); return this.go(shop.id, shop, 'sell'); // กล่องที่ไม่มีใครสั่ง ขายทิ้ง
      }
      if (k.startsWith('crop:')) {
        const pk = closest(T(S.packers.map((x) => ({ ...x, ...L.packers.find((q) => q.id === x.id) })), (x) => !x.item && this.free(x.id)));
        if (pk) return this.go(pk.id, pk, 'pack');
        return putDown();
      }
      if (k.startsWith('feed:')) {
        const an = closest(animalsFull().filter((a) => !a.fed && this.free(a.id)));
        if (an) return this.go(an.id, an, 'feed');
        const bin = closest(station('G')); return this.go(bin.id, bin, 'trash');
      }
      if (k === 'tool:sprinkler') {
        // ยืนบนแปลงที่มีแปลงรอบตัวมากสุด (และยังไม่มีสปริงเกอร์ใกล้ๆ) แล้ววางลงพื้น
        const spots = plotsFull.filter((p) => !S.ground.some((g) => g.item.k === 'tool:sprinkler' && Math.hypot(g.x - p.x, g.y - p.y) < 150));
        const score = (p) => plotsFull.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 95).length;
        const best = spots.sort((a, b) => score(b) - score(a))[0];
        if (best) return this.go(null, best, 'drop', { radius: 8 });
        return putDown();
      }
      if (k.startsWith('seed:')) {
        const pl = closest(T(plotsFull, (p) => p.soil === 'tilled' && !p.crop && this.free(p.id)));
        if (pl) return this.go(pl.id, pl, 'plant');
        return putDown();
      }
      if (k === 'tool:hoe') {
        const tilledEmpty = T(plotsFull, (p) => p.soil === 'tilled' && !p.crop).length;
        const raw = closest(T(plotsFull, (p) => p.soil === 'raw' && !p.crop && this.free(p.id)));
        if (raw && tilledEmpty < 3) return this.go(raw.id, raw, 'use', { kind: 'till' });
        return putDown();
      }
      if (k === 'tool:can') {
        if ((h.water ?? 0) <= 0) { const w = closest(station('W')); return this.go(w.id, w, 'use', { kind: 'refill' }); }
        const dry = closest(T(plotsFull, (p) => p.crop && plotStage(p, t) !== 3 && (p.moistUntil || 0) < t + 1500 && this.free(p.id)));
        if (dry) return this.go(dry.id, dry, 'use', { kind: 'water' });
        return putDown();
      }
      return putDown(); // เคียว ฯลฯ
    }

    // มือว่าง
    const boxInPacker = closest(T(S.packers.map((x) => ({ ...x, ...L.packers.find((q) => q.id === x.id) })), (x) => x.item && x.readyAt == null && x.item.k.startsWith('box:') && wantedBox(x.item.k) && this.free(x.id)));
    if (boxInPacker) return this.go(boxInPacker.id, boxInPacker, 'take-box');
    // จุดแพ็กตันด้วยกล่องที่ไม่มีออเดอร์ + มีของดิบรอแพ็ก → เอากล่องออก (ไปขาย)
    const crudeWaiting = S.counters.some((c) => c.item?.k.startsWith('crop:')) || S.ground.some((g) => g.item.k.startsWith('crop:'));
    const clog = crudeWaiting && !packerList.some((x) => !x.item) && closest(packerList.filter((x) => x.item?.k.startsWith('box:') && !wantedBox(x.item.k) && this.free(x.id)));
    if (clog) return this.go(clog.id, clog, 'take-box');
    const ready = closest(T(plotsFull, (p) => plotStage(p, t) === 3 && this.free(p.id)));
    if (ready) return this.go(ready.id, ready, 'harvest');
    const laid = closest(animalsFull().filter((a) => a.fed && a.readyAt <= t && this.free(a.id)));
    if (laid) return this.go(laid.id, laid, 'collect');
    // สปริงเกอร์ที่ยังอยู่บนโต๊ะ (ของฟรีทีมเล็ก / ซื้อมา) — เอาไปวางกลางแปลง
    const spr = closest([...S.counters.filter((c) => c.item?.k === 'tool:sprinkler').map((c) => ({ ...c, ...counterPos(c.id) }))].filter((x) => this.free(x.id)));
    if (spr) return this.go(spr.id, spr, 'get-sprinkler');
    const loose = closest(T(S.ground, (g) => (g.item.k.startsWith('crop:') || (g.item.k.startsWith('box:') && wantedBox(g.item.k))) && this.free(g.id)));
    if (loose) return this.go(loose.id, loose, 'pickup', { radius: 60 });
    const onCounter = closest(T(S.counters.map((c) => ({ ...c, ...counterPos(c.id) })), (c) => c.item && (c.item.k.startsWith('crop:') || (c.item.k.startsWith('box:') && wantedBox(c.item.k))) && this.free(c.id)));
    if (onCounter) return this.go(onCounter.id, onCounter, 'pickup');

    const toolAt = (id) => {
      const opts = [
        ...S.counters.filter((c) => c.item?.k === `tool:${id}`).map((c) => ({ ...c, ...counterPos(c.id) })),
        ...S.ground.filter((g) => g.item.k === `tool:${id}`),
      ].filter((x) => this.free(x.id));
      return closest(opts);
    };
    const dry = T(plotsFull, (p) => p.crop && plotStage(p, t) !== 3 && (p.moistUntil || 0) < t + 1500);
    const canHolders = W.players.filter((p) => p.held?.k === 'tool:can').length;
    if (dry.length > canHolders) { const can = toolAt('can'); if (can) return this.go(can.id, can, 'get-can'); }

    const d = demand();
    const hungry = animalsFull().filter((a) => !a.fed && (d[PRODUCT[a.type]] || 0) > 0);
    const feedHolders = W.players.filter((p) => p.held?.k?.startsWith('feed:')).length;
    if (hungry.length > feedHolders) return this.go(null, closest(station('D')), 'feed-bag');
    const needCrop = Object.entries(d).filter(([c, v]) => v > 0 && W.catalog.cropOrder.includes(c)).sort((a, b) => b[1] - a[1])[0];
    const tilledEmpty = T(plotsFull, (p) => p.soil === 'tilled' && !p.crop);
    const seedHolders = W.players.filter((p) => p.held?.k?.startsWith('seed:')).length;
    if (tilledEmpty.length > seedHolders && needCrop) {
      const cropId = needCrop[0];
      const seedCost = W.level && W.team ? 0 : 0;
      const ds = closest(station('D'));
      return this.go(null, ds, 'seed', { crop: cropId });
    }
    const hoeHolders = W.players.filter((p) => p.held?.k === 'tool:hoe').length;
    const raws = T(plotsFull, (p) => p.soil === 'raw' && !p.crop);
    if (raws.length && tilledEmpty.length < 3 && hoeHolders === 0 && needCrop) { const hoe = toolAt('hoe'); if (hoe) return this.go(hoe.id, hoe, 'get-hoe'); }
    return null;
  }
}

const bots = Array.from({ length: N }, (_, i) => new Bot(i));
let last = Date.now();
setInterval(() => {
  const n = Date.now();
  const dt = n - last;
  last = n;
  for (const b of bots) b.tick(dt);
}, 100);

function report() {
  const e = stats.end;
  const orders = [...stats.ordersSeen.values()];
  const out = {
    label: LABEL, bots: N, map: e?.mapName, score: e?.score, stars: e?.stars, thresholds: e?.thresholds, completed: e?.completed, failed: e?.failed,
    ordersSpawned: orders.length, rush: orders.filter((o) => o.rush).length,
    firstOrderDoneAt: stats.firstOrderDone,
    orderTotalSec: summarize(orders.map((o) => o.totalSec)),
    completedLeftSec: summarize(stats.completed.map((c) => c.left)),
    idlePct: stats.idleMs.map((ms, i) => Math.round((100 * ms) / (ms + stats.busyMs[i] || 1))),
    actions: stats.actions,
    stuck: stats.stuck.slice(0, 10), stuckCount: stats.stuck.length,
    toasts: stats.toasts,
  };
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}
function summarize(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return { n: a.length, min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}
setTimeout(() => { console.log('TIMEOUT'); report(); }, (+process.argv[5] || 420) * 1000);
