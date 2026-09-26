import type { LevelView, Pos } from '../level/collision'
import type { Catalog, ItemView, LevelState, OrderView, PlayerView } from '../types'
import { liveStage } from '../render/World'

export interface Hint {
  x: number
  y: number
  h: number // ความสูงลูกศร (หน่วยโลก)
  text: string
}

interface Ctx {
  level: LevelView
  state: LevelState
  orders: OrderView[]
  players: PlayerView[]
  catalog: Catalog
  me: Pos
  held: ItemView | null
  now: number
}

/**
 * ตัวช่วยนำทาง: "ควรทำอะไรต่อ" จากของในมือ + ออเดอร์ที่ค้าง → จุดที่ควรไป + ข้อความสั้นๆ
 * (ลูกศรเด้งเหนือจุดนั้น + บรรทัดใต้ป้ายของในมือ) — เดาแบบง่ายๆ ไม่ต้องเป๊ะ แค่ให้คนใหม่/ทีมเล็กไม่งง
 * ใช้ข้อมูลที่ client มีอยู่แล้วทั้งหมด ไม่ถาม server
 */
export function computeHint(c: Ctx): Hint | null {
  const { level: L, state: S, catalog, me, held, now } = c
  const d = (p: Pos) => Math.hypot(p.x - me.x, p.y - me.y)
  const nearest = <T extends Pos>(list: T[]) => list.sort((a, b) => d(a) - d(b))[0]
  const at = (p: Pos | undefined, text: string, h = 1.3): Hint | null => (p ? { x: p.x, y: p.y, h, text } : null)
  const station = (type: string) => nearest(L.stations.filter((s) => s.type === type))
  const plots = S.plots.map((p) => ({ ...p, ...L.plots.find((q) => q.id === p.id)! }))
  const animals = (S.animals || []).map((a) => ({ ...a, ...L.animals.find((q) => q.id === a.id)! }))
  const counters = S.counters.map((s) => ({ ...s, ...L.counters.find((q) => q.id === s.id)! }))
  const packers = S.packers.map((s) => ({ ...s, ...L.packers.find((q) => q.id === s.id)! }))
  const need = new Map<string, number>() // item.k → ยังขาดกี่ชิ้น
  for (const o of c.orders) for (const [k, it] of Object.entries(o.items)) need.set(k, (need.get(k) || 0) + it.need - it.have)
  const wanted = (k: string) => (need.get(k) || 0) > 0
  const stage = (p: (typeof plots)[number]) => liveStage(p, S.serverNow, now)
  const growingDry = plots.filter((p) => p.crop && stage(p) < 3 && p.moistUntil <= now)
  const toolAt = (id: string) => nearest([...counters.filter((x) => x.item?.k === `tool:${id}`), ...S.ground.filter((g) => g.item.k === `tool:${id}`)])
  const name = (id: string) => catalog.allCrops[id]?.name ?? id

  if (held) {
    const [kind, id] = held.k.split(':')
    if (kind === 'box') return wanted(held.k) ? at(station('B'), '🚚 เอากล่องไปส่งที่รถ', 1.9) : at(nearest(counters.filter((x) => !x.item)), 'ยังไม่มีออเดอร์นี้ — วางพักบนโต๊ะไว้ก่อน')
    if (kind === 'crop') return at(nearest(packers.filter((x) => !x.item)) || nearest(packers), `📦 เอา${name(id)}ไปแพ็กก่อนส่ง`)
    if (kind === 'seed') {
      const spot = nearest(plots.filter((p) => p.soil === 'tilled' && !p.crop))
      return spot ? at(spot, `🌱 ปลูกที่แปลงที่ไถแล้ว`, 0.9) : at(toolAt('hoe') || nearest(plots.filter((p) => !p.crop)), '⛏️ ยังไม่มีแปลงว่าง — ต้องไถดินด้วยจอบก่อน')
    }
    if (kind === 'feed') return at(nearest(animals.filter((a) => !a.fed)), '🌾 เอาอาหารไปให้สัตว์ที่หิว', 1.1)
    if (held.k === 'tool:can') {
      if ((held.water ?? 0) <= 0) return at(station('W'), '💧 บัวหมดน้ำ — ไปเติมที่บ่อ', 0.8)
      const dry = nearest(growingDry)
      return dry ? at(dry, '🚿 รดน้ำแปลงที่แห้ง (มี 💧)', 0.9) : null
    }
    if (held.k === 'tool:hoe') {
      const raw = nearest(plots.filter((p) => p.soil === 'raw' && !p.crop))
      return raw ? at(raw, '⛏️ ไถแปลงดินเปล่า', 0.9) : null
    }
    if (held.k === 'tool:sprinkler') {
      // กลางกลุ่มแปลงที่ยังไม่มีสปริงเกอร์
      const score = (p: Pos) => plots.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 95).length
      const spot = plots
        .filter((p) => !S.ground.some((g) => g.item.k === 'tool:sprinkler' && Math.hypot(g.x - p.x, g.y - p.y) < 150))
        .sort((a, b) => score(b) - score(a) || d(a) - d(b))[0]
      return at(spot, '💦 ยืนกลางแปลงแล้วกด "วางพื้น" — มันจะรดน้ำรอบๆ ให้เอง', 0.9)
    }
    if (held.k === 'tool:scarecrow') return at(nearest(plots), '🧑‍🌾 วางพื้นใกล้แปลง — แมลงจะไม่กล้ามา', 0.9)
    return null
  }

  // มือว่าง: ของที่พร้อมอยู่แล้วมาก่อน
  const boxReady = nearest(packers.filter((x) => x.item?.k.startsWith('box:') || (x.item && x.readyAt != null && now >= x.readyAt)))
  if (boxReady) return at(boxReady, '📦 กล่องแพ็กเสร็จแล้ว หยิบไปส่ง')
  const loose = nearest(S.ground.filter((g) => g.item.k.startsWith('box:') && wanted(g.item.k)))
  if (loose) return at(loose, '🎁 มีกล่องที่ออเดอร์ต้องการอยู่บนพื้น', 0.8)
  const ripe = nearest(plots.filter((p) => stage(p) === 3))
  if (ripe) return at(ripe, '🧺 พืชโตแล้ว เก็บเกี่ยวเลย', 1.0)
  const laid = nearest(animals.filter((a) => a.fed && a.readyAt != null && now >= a.readyAt))
  if (laid) return at(laid, `${catalog.allCrops[catalog.animals[laid.type]?.product]?.emoji ?? ''} ได้ของจากสัตว์แล้ว ไปเก็บ`, 1.1)
  if (!c.orders.length) return null
  // ของที่ออเดอร์ขาดและยังไม่มีอะไรกำลังทำ
  const busy = new Map<string, number>()
  for (const p of plots) if (p.crop) busy.set(p.crop, (busy.get(p.crop) || 0) + 1)
  for (const a of animals) if (a.fed) busy.set(catalog.animals[a.type]?.product, (busy.get(catalog.animals[a.type]?.product) || 0) + 1)
  const missing = [...need.entries()].filter(([k, n]) => n > (busy.get(k.slice(4)) || 0)).map(([k]) => k.slice(4))
  const product = missing.find((id) => catalog.products?.includes(id))
  if (product && animals.some((a) => !a.fed && catalog.animals[a.type]?.product === product)) return at(station('D'), `🌾 หยิบอาหารสัตว์ไปเลี้ยง (ได้${name(product)})`)
  const cropNeeded = missing.find((id) => catalog.cropOrder.includes(id))
  if (cropNeeded) {
    if (plots.some((p) => p.soil === 'tilled' && !p.crop)) return at(station('D'), `🌱 หยิบเมล็ด${name(cropNeeded)}`)
    const hoe = toolAt('hoe')
    if (hoe && plots.some((p) => p.soil === 'raw' && !p.crop)) return at(hoe, '⛏️ หยิบจอบไปไถดินก่อนปลูก', 1.1)
  }
  if (growingDry.length) {
    const can = toolAt('can')
    if (can) return at(can, '🚿 พืชขาดน้ำ — หยิบบัวไปรด', 1.1)
  }
  return null
}
