import type { LevelView, Pos } from '../level/collision'
import type { LevelState } from '../types'

// สูตรเดียวกับ server/src/targets.js — client เลือกเป้าหมาย (ไฮไลต์ + ตั้งชื่อปุ่ม) แล้วส่ง id ไป
// server แค่ตรวจว่าอยู่ในระยะ SERVER_REACH (115) ซึ่งกว้างกว่า CLIENT_REACH นี้โดยตั้งใจ
const AHEAD = 40
const CLIENT_REACH = 80

export type TargetKind = 'plot' | 'counter' | 'packer' | 'animal' | 'ground' | 'shop' | 'seeds' | 'truck' | 'pond' | 'trash'
export interface Target {
  id: string
  kind: TargetKind
  x: number
  y: number
}

const STATION_KIND: Record<string, TargetKind> = { S: 'shop', D: 'seeds', B: 'truck', W: 'pond', G: 'trash' }

export function listTargets(L: LevelView, s: LevelState): Target[] {
  const out: Target[] = []
  for (const p of L.plots) out.push({ id: p.id, kind: 'plot', x: p.x, y: p.y })
  for (const c of L.counters) out.push({ id: c.id, kind: 'counter', x: c.x, y: c.y })
  for (const k of L.packers) out.push({ id: k.id, kind: 'packer', x: k.x, y: k.y })
  for (const a of L.animals || []) out.push({ id: a.id, kind: 'animal', x: a.x, y: a.y })
  for (const g of s.ground) out.push({ id: g.id, kind: 'ground', x: g.x, y: g.y })
  for (const st of L.stations) out.push({ id: st.id, kind: STATION_KIND[st.type], x: st.x, y: st.y })
  return out
}

/** สิ่งที่อยู่ในระยะเอื้อมและใกล้ "จุดหน้าตัวละคร" ที่สุด */
export function pickTarget(targets: Target[], me: Pos, fx: number, fy: number): Target | null {
  const px = me.x + fx * AHEAD
  const py = me.y + fy * AHEAD
  let best: Target | null = null
  let bestD = Infinity
  for (const t of targets) {
    if (Math.hypot(t.x - me.x, t.y - me.y) > CLIENT_REACH) continue
    const d = Math.hypot(t.x - px, t.y - py)
    if (d < bestD) {
      best = t
      bestD = d
    }
  }
  return best
}
