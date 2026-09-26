/**
 * การกระทำของผู้เล่น (แบบ Overcooked) — ถือได้ทีละ 1 ชิ้น
 *
 *   act:primary {targetId}  หยิบ/วาง: ว่างมือ = หยิบจากโต๊ะ/พื้น/จุดแพ็ก/แปลงที่พร้อมเก็บ, เปิดกล่องเมล็ด/ร้าน
 *                           มีของ = วางบนโต๊ะ/ใส่จุดแพ็ก/ปลูก/ส่งรถ/ขายที่ร้าน/ทิ้งถังขยะ/เติมบัว
 *                           ไม่มีเป้าหมาย = วางของลงพื้นตรงหน้า · แปลงที่มีแมลง = ไล่แมลงก่อนเสมอ
 *   act:use {targetId}      ใช้เครื่องมือในมือ — จอบไถ, บัวรด, เคียวเกี่ยว: ต้องยืนอยู่จนครบ WORK_MS
 *                           (แตะครั้งเดียวพอ มือถือกดค้างยาก) เดินออก/ทำอย่างอื่น = ยกเลิก
 *   act:throw               โยนของในมือไปข้างหน้า ≤ THROW_TILES ช่อง ตกบนโต๊ะว่างที่ขวางอยู่หรือพื้น
 *   act:seed {crop}         (ยืนที่กล่องเมล็ด มือว่าง) รับถุงเมล็ด หักเงินทีม — crop 'feed' = อาหารสัตว์ (ฟรี)
 *                           อัปเกรดถุงใหญ่: item.n = SEED_BAG_USES ใช้ได้หลายครั้งก่อนหมดมือ
 *   act:buy {id}            (ยืนที่ร้าน) ซื้อเครื่องมือเพิ่ม/อัปเกรด
 *
 * ทุก handler ทำงานบน G.s (รอบปัจจุบัน) แล้ว G.markDirty() ให้ส่ง level:state ใหม่
 */
const C = require('./content');
const { findTarget, SERVER_REACH } = require('./targets');
const { blockedAt } = require('./level');

function attachActions(G) {
  const { io, world } = G;
  const held = (uuid) => G.s.held.get(uuid) || null;
  const setHeld = (uuid, it) => (it ? G.s.held.set(uuid, it) : G.s.held.delete(uuid));
  const isTool = (it, id) => it && it.k === `tool:${id}`;

  /** ใช้ถุงเมล็ด/อาหารสัตว์ไป 1 ครั้ง — ถุงใหญ่ (item.n) เหลือก็ถือต่อ หมดแล้วมือว่าง */
  function useOne(uuid, h) {
    if (h.n > 1) h.n -= 1;
    else setHeld(uuid, null);
  }

  function cancelWork(uuid) {
    const w = G.s.work.get(uuid);
    if (w) clearTimeout(w.timer);
    G.s.work.delete(uuid);
  }

  /** คนส่ง + ตำแหน่ง ถ้ากำลังเล่นรอบ — ไม่งั้น null */
  function who(socket) {
    if (!G.playing()) return null;
    const uuid = socket.data.uuid;
    const me = uuid && world.getOnline(uuid);
    return me ? { uuid, me } : null;
  }

  /** เป้าหมายที่ client ส่งมา ถ้ามีจริงและอยู่ในระยะ — ไม่งั้น null + บอกเหตุผล */
  function resolve(socket, me, targetId) {
    const t = findTarget(G.s, targetId);
    if (!t) return null;
    if (Math.hypot(t.x - me.x, t.y - me.y) > SERVER_REACH) {
      G.toast(socket, 'อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน');
      return null;
    }
    return t;
  }

  /** จุดหน้าตัวละครที่วางของลงพื้นได้ (ถ้าข้างหน้าเป็นช่องทึบ วางที่เท้าแทน) */
  function frontSpot(me) {
    const x = me.x + (me.fx || 0) * 30;
    const y = me.y + (me.fy || 1) * 30;
    return blockedAt(G.s.level, x, y) ? { x: me.x, y: me.y } : { x, y };
  }

  /** เก็บเกี่ยว — ชิ้นแรกคืนให้ผู้เรียก ที่เหลือ (เคียว/ปุ๋ย) หล่นพื้นรอบแปลง · ไส้เดือนดิน = ดินยังไถไว้ ปลูกต่อได้เลย */
  function harvest(plot, amount) {
    const crop = plot.crop;
    G.clearPlot(plot);
    if (G.hasUpgrade('good_soil')) plot.soil = 'tilled';
    const items = Array.from({ length: amount }, () => G.item(`crop:${crop}`));
    return items;
  }
  function scatter(items, x, y) {
    items.forEach((it, i) => {
      const a = (i / Math.max(1, items.length)) * Math.PI * 2 + Math.random();
      G.dropGround(it, x + Math.cos(a) * 26, y + Math.sin(a) * 26);
    });
  }

  function startWork(socket, uuid, t, kind, ms, done) {
    cancelWork(uuid);
    const roundId = G.s.id;
    const heldUid = held(uuid)?.uid;
    const timer = setTimeout(() => {
      if (G.s.id !== roundId || !G.playing()) return;
      if (G.s.work.get(uuid)?.timer !== timer) return;
      G.s.work.delete(uuid);
      const me = world.getOnline(uuid);
      if (!me || Math.hypot(t.x - me.x, t.y - me.y) > SERVER_REACH) {
        G.markDirty();
        return G.toast(socket, 'เดินออกไปก่อนทำเสร็จ — ยกเลิก');
      }
      if (held(uuid)?.uid !== heldUid) return G.markDirty();
      done();
      G.markDirty();
    }, ms);
    G.s.work.set(uuid, { targetId: t.id, kind, until: Date.now() + ms, total: ms, timer });
    G.markDirty();
  }

  io.on('connection', (socket) => {
    socket.on('act:primary', ({ targetId } = {}) => {
      const w = who(socket);
      if (!w) return;
      const { uuid, me } = w;
      const t = targetId ? resolve(socket, me, targetId) : null;
      if (targetId && !t) return;
      cancelWork(uuid);
      const h = held(uuid);
      const now = Date.now();

      // แปลงที่มีแมลง: ไล่แมลงก่อนเสมอ ไม่ว่าถืออะไรอยู่
      if (t?.kind === 'plot' && t.ref.pestUntil) {
        t.ref.pestUntil = null;
        G.fx({ type: 'shoo', x: t.x, y: t.y });
        return G.markDirty();
      }

      if (!h) {
        if (!t) return;
        const r = t.ref;
        if (t.kind === 'counter' && r.item) {
          setHeld(uuid, r.item);
          r.item = null;
        } else if (t.kind === 'packer' && r.item) {
          G.settlePacker(r, now);
          setHeld(uuid, r.item); // ยังแพ็กไม่เสร็จ = หยิบของดิบคืน (ยกเลิกแพ็ก)
          r.item = null;
          r.readyAt = null;
        } else if (t.kind === 'ground') {
          setHeld(uuid, r.item);
          G.s.ground.delete(r.id);
        } else if (t.kind === 'animal' && r.fed && now >= r.readyAt) {
          const product = C.ANIMALS[r.type].product;
          Object.assign(r, { fed: false, readyAt: null, total: 0 });
          setHeld(uuid, G.item(`crop:${product}`));
          G.fx({ type: 'harvest', x: r.x, y: r.y });
        } else if (t.kind === 'animal') {
          return G.toast(socket, r.fed ? `${C.ANIMALS[r.type].emoji} กำลังทำ${C.CROPS[C.ANIMALS[r.type].product].name}อยู่ รอแป๊บ` : `${C.ANIMALS[r.type].emoji} หิวแล้ว — เอาอาหารสัตว์ 🌾 จากกล่องเมล็ดมาให้`);
        } else if (t.kind === 'plot' && G.plotReady(r, now)) {
          const items = harvest(r, 1 + (G.hasUpgrade('fertilizer') ? 1 : 0));
          setHeld(uuid, items.shift());
          scatter(items, r.x, r.y);
          G.fx({ type: 'harvest', x: r.x, y: r.y });
        } else if (t.kind === 'seeds') {
          return socket.emit('ui:seeds');
        } else if (t.kind === 'shop') {
          return socket.emit('ui:shop');
        } else return;
        return G.markDirty();
      }

      // ── มือไม่ว่าง ──
      if (!t || t.kind === 'ground') {
        const spot = frontSpot(me);
        G.dropGround(h, spot.x, spot.y);
        setHeld(uuid, null);
        return G.markDirty();
      }
      const r = t.ref;
      switch (t.kind) {
        case 'counter':
          if (r.item) return G.toast(socket, 'โต๊ะมีของอยู่แล้ว');
          r.item = h;
          setHeld(uuid, null);
          break;
        case 'packer':
          if (r.item) return G.toast(socket, 'จุดแพ็กไม่ว่าง');
          if (!h.k.startsWith('crop:')) {
            return G.toast(socket, h.k.startsWith('box:') ? 'แพ็กแล้ว เอาไปส่งที่รถได้เลย' : 'แพ็กได้เฉพาะผลผลิต');
          }
          r.item = h;
          r.total = G.packMs();
          r.readyAt = now + r.total;
          setHeld(uuid, null);
          break;
        case 'animal': {
          if (!h.k.startsWith('feed:')) return G.toast(socket, `${C.ANIMALS[r.type].emoji} กินแต่อาหารสัตว์ 🌾 (หยิบฟรีที่กล่องเมล็ด)`);
          if (r.fed) return G.toast(socket, r.readyAt <= now ? 'มีของให้เก็บอยู่ — มือว่างแล้วกดเก็บก่อน' : 'ยังอิ่มอยู่');
          const product = C.ANIMALS[r.type].product;
          r.total = G.growMs(product);
          Object.assign(r, { fed: true, readyAt: now + r.total });
          useOne(uuid, h);
          G.fx({ type: 'feed', x: r.x, y: r.y });
          break;
        }
        case 'plot':
          if (h.k.startsWith('seed:')) {
            if (r.crop) return G.toast(socket, 'แปลงนี้มีพืชอยู่แล้ว');
            if (r.soil !== 'tilled') return G.toast(socket, 'ต้องไถดินก่อน (ถือจอบแล้วกด ใช้)');
            G.settlePlot(r, now);
            Object.assign(r, { crop: h.k.slice(5), progressMs: 0, lastTs: now });
            useOne(uuid, h);
            G.fx({ type: 'plant', x: r.x, y: r.y });
            break;
          }
          // ของอื่นที่ไม่ใช่เมล็ด = วางลงพื้นตรงหน้า (ยืนกลางแปลง เป้าหมายเป็นแปลงหมด เดิมเลยวางของไม่ได้เลย)
          {
            const spot = frontSpot(me);
            G.dropGround(h, spot.x, spot.y);
            setHeld(uuid, null);
          }
          break;
        case 'truck':
          if (!G.deliver(socket, uuid, h)) return;
          setHeld(uuid, null);
          break;
        case 'trash':
          if (h.k.startsWith('tool:')) return G.toast(socket, 'ทิ้งเครื่องมือไม่ได้');
          setHeld(uuid, null);
          G.fx({ type: 'trash', x: r.x, y: r.y });
          break;
        case 'pond':
          if (!isTool(h, 'can')) return G.toast(socket, 'เอาบัวรดน้ำมาเติมน้ำ');
          h.water = G.canCap();
          G.fx({ type: 'splash', x: r.x, y: r.y });
          break;
        case 'shop': {
          const crop = h.k.split(':')[1];
          if (!(h.k.startsWith('crop:') || h.k.startsWith('box:'))) return G.toast(socket, 'ร้านรับซื้อเฉพาะผลผลิต');
          const price = (C.CROPS[crop]?.sell || 0) * G.sellMul();
          G.s.team.coins += price;
          setHeld(uuid, null);
          G.broadcastTeam();
          G.toast(socket, `ขายได้ +${price} 🪙 (ไม่ได้คะแนน — ส่งออกออเดอร์คุ้มกว่า)`);
          break;
        }
        case 'seeds':
          return G.toast(socket, 'มือไม่ว่าง วางของก่อน');
        default:
          return;
      }
      G.markDirty();
    });

    socket.on('act:use', ({ targetId } = {}) => {
      const w = who(socket);
      if (!w) return;
      const { uuid, me } = w;
      const h = held(uuid);
      if (!h || !h.k.startsWith('tool:')) return G.toast(socket, 'ต้องถือเครื่องมือก่อน (หยิบจากชั้นเครื่องมือ)');
      const t = targetId ? resolve(socket, me, targetId) : null;
      if (!t) return;
      const r = t.ref;
      const now = Date.now();

      if (isTool(h, 'can') && t.kind === 'pond') {
        h.water = G.canCap();
        G.fx({ type: 'splash', x: r.x, y: r.y });
        return G.markDirty();
      }
      if (C.TOOLS[h.k.slice(5)]?.gadget) return G.toast(socket, 'วางลงพื้นใกล้แปลงแล้วมันจะทำงานเอง');
      if (t.kind !== 'plot') return G.toast(socket, 'ใช้เครื่องมือกับแปลงดิน');

      if (isTool(h, 'hoe')) {
        if (r.crop && G.plotReady(r, now)) return G.toast(socket, 'พร้อมเก็บแล้ว เก็บเกี่ยวก่อน');
        if (!r.crop && r.soil === 'tilled') return G.toast(socket, 'ไถแล้ว ปลูกได้เลย');
        return startWork(socket, uuid, t, 'till', C.WORK_MS.till, () => {
          G.settlePlot(r, Date.now());
          Object.assign(r, { soil: 'tilled', crop: null, progressMs: 0, pestUntil: null });
          G.fx({ type: 'dust', x: r.x, y: r.y });
        });
      }
      if (isTool(h, 'can')) {
        if (r.soil !== 'tilled') return G.toast(socket, 'ต้องไถดินก่อน');
        if (r.crop && G.plotReady(r, now)) return G.toast(socket, 'พร้อมเก็บแล้ว ไม่ต้องรด');
        if ((h.water || 0) <= 0) return G.toast(socket, 'บัวหมดน้ำ ไปเติมที่บ่อ 💧');
        return startWork(socket, uuid, t, 'water', C.WORK_MS.water, () => {
          h.water -= 1;
          G.moisten(r, Date.now());
          G.fx({ type: 'water', x: r.x, y: r.y });
        });
      }
      if (isTool(h, 'sickle')) {
        if (!r.crop || !G.plotReady(r, now)) return G.toast(socket, 'ยังไม่พร้อมเก็บ');
        return startWork(socket, uuid, t, 'reap', C.WORK_MS.reap, () => {
          if (!r.crop || !G.plotReady(r, Date.now())) return;
          // เคียว: ได้ +1 เสมอ (+ปุ๋ยอีก 1) แต่มือถือเคียวอยู่ ผลผลิตเลยหล่นพื้นให้คนอื่นช่วยเก็บ
          scatter(harvest(r, 2 + (G.hasUpgrade('fertilizer') ? 1 : 0)), r.x, r.y);
          G.fx({ type: 'harvest', x: r.x, y: r.y });
        });
      }
    });

    socket.on('act:throw', () => {
      const w = who(socket);
      if (!w) return;
      const { uuid, me } = w;
      const h = held(uuid);
      if (!h) return;
      cancelWork(uuid);
      const fx = me.fx || 0;
      const fy = me.fy || 1;
      const L = G.s.level;
      let landX = me.x;
      let landY = me.y;
      let onCounter = null;
      for (let d = 24; d <= C.THROW_TILES * L.tile; d += 8) {
        const x = me.x + fx * d;
        const y = me.y + fy * d;
        if (blockedAt(L, x, y)) {
          // ชนโต๊ะว่าง = ตกบนโต๊ะนั้น, ชนอย่างอื่น = ตกพื้นตรงก่อนชน
          const c = Math.floor(x / L.tile);
          const rr = Math.floor(y / L.tile);
          onCounter = G.s.counters.find((k) => !k.item && Math.floor(k.x / L.tile) === c && Math.floor(k.y / L.tile) === rr);
          if (onCounter) {
            landX = onCounter.x;
            landY = onCounter.y;
          }
          break;
        }
        landX = x;
        landY = y;
      }
      setHeld(uuid, null);
      if (onCounter) onCounter.item = h;
      else G.dropGround(h, landX, landY);
      G.fx({ type: 'throw', from: { x: me.x, y: me.y }, to: { x: landX, y: landY }, k: h.k });
      G.markDirty();
    });

    socket.on('act:seed', ({ crop } = {}) => {
      const w = who(socket);
      if (!w) return;
      const { uuid, me } = w;
      if (held(uuid)) return G.toast(socket, 'มือไม่ว่าง วางของก่อน');
      const seeds = G.s.level.stations.filter((s) => s.type === 'D');
      if (!G.nearest(seeds, me, SERVER_REACH)) return G.toast(socket, 'อยู่ไกลกล่องเมล็ด');
      const bag = G.hasUpgrade('seed_bag') ? { n: C.SEED_BAG_USES } : {};
      if (crop === 'feed') {
        const animals = G.s.level.animals.length;
        if (!animals) return;
        // ถุงใหญ่ไม่เกินจำนวนสัตว์ในแผนที่ (วัวตัวเดียวได้ถุง 3 ครั้ง = เหลือทิ้งทุกรอบ)
        setHeld(uuid, G.item('feed:grain', bag.n && animals > 1 ? { n: Math.min(bag.n, animals) } : {}));
        return G.markDirty();
      }
      if (!G.s.level.crops.includes(crop)) return;
      const price = C.CROPS[crop].seed;
      if (G.s.team.coins < price) return G.toast(socket, `เงินทีมไม่พอ (${price} 🪙)`);
      G.s.team.coins -= price;
      setHeld(uuid, G.item(`seed:${crop}`, bag));
      if (price) G.broadcastTeam();
      G.markDirty();
    });

    socket.on('act:buy', ({ id } = {}) => {
      const w = who(socket);
      if (!w) return;
      const { uuid, me } = w;
      const shops = G.s.level.stations.filter((s) => s.type === 'S');
      const shop = G.nearest(shops, me, SERVER_REACH);
      if (!shop) return G.toast(socket, 'อยู่ไกลร้าน');
      const def = C.SHOP.find((x) => x.id === id);
      const item = G.shopItems().find((x) => x.id === id);
      if (!def || !item || item.price == null) return;
      if (G.s.team.coins < item.price) return G.toast(socket, `เงินทีมไม่พอ (ต้องการ ${item.price} 🪙)`);
      G.s.team.coins -= item.price;
      G.s.team.bought[id] = (G.s.team.bought[id] || 0) + 1;
      if (id.startsWith('tool:')) {
        // เครื่องมือใหม่วางบนโต๊ะว่างที่ใกล้ร้านที่สุด ไม่มีโต๊ะว่างก็วางพื้นหน้าคนซื้อ
        const tool = G.newTool(id.slice(5));
        const free = G.s.counters.filter((c) => !c.item).sort((a, b) => Math.hypot(a.x - shop.x, a.y - shop.y) - Math.hypot(b.x - shop.x, b.y - shop.y))[0];
        if (free) free.item = tool;
        else G.dropGround(tool, me.x, me.y);
      } else {
        G.s.team.upgrades[id.slice(3)] = true;
        if (id === 'up:big_can') {
          const all = [...G.s.held.values(), ...G.s.counters.map((c) => c.item), ...[...G.s.ground.values()].map((g) => g.item)];
          for (const it of all) if (isTool(it, 'can')) it.water = G.canCap();
        }
      }
      G.broadcastTeam();
      G.markDirty();
      G.toastAll(`🎉 ${me.name} ซื้อ ${def.emoji} ${def.name}`);
    });
  });
}

module.exports = { attachActions };
