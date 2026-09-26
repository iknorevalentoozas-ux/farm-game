// สำเนาของ server/src/level.js (ส่วนการชน) — **ต้องตรงกันทุกค่า** ไม่งั้นตัวละครเดินทะลุบนจอเรา
// แล้วโดน server ดึงกลับตลอด ใช้ทำนายการเดินของตัวเองล่วงหน้าเท่านั้น server เป็นคนตัดสินจริง
export const RADIUS = 14
export const BLOCKING = new Set(['#', 'T', 'W', 'S', 'K', 'B', 'C', 'R', 'D', 'G', 'H', 'M'])

export interface Pos {
  x: number
  y: number
}
export interface Spot extends Pos {
  id: string
}

export type Theme = 'grass' | 'spring' | 'desert' | 'snow'

export interface LevelView {
  id: string
  theme: Theme
  tiles: string[]
  tile: number
  cols: number
  rows: number
  w: number
  h: number
  plots: Spot[]
  counters: (Spot & { rack: boolean })[]
  packers: Spot[]
  animals: (Spot & { type: 'chicken' | 'cow' })[]
  stations: (Spot & { type: 'S' | 'D' | 'B' | 'W' | 'G' })[]
}

export function blockedAt(L: LevelView, x: number, y: number) {
  const c = Math.floor(x / L.tile)
  const r = Math.floor(y / L.tile)
  if (r < 0 || c < 0 || r >= L.rows || c >= L.cols) return true
  return BLOCKING.has(L.tiles[r][c])
}

function collides(L: LevelView, x: number, y: number) {
  return (
    blockedAt(L, x - RADIUS, y - RADIUS) ||
    blockedAt(L, x + RADIUS, y - RADIUS) ||
    blockedAt(L, x - RADIUS, y + RADIUS) ||
    blockedAt(L, x + RADIUS, y + RADIUS)
  )
}

const SUBSTEP = 4 // ต้องเท่ากับ server — ซอยก้าวให้ชนกำแพงจุดเดียวกันทั้งสองฝั่ง
const NUDGE = 20 // เยื้องจากช่องว่างไม่เกินนี้ ช่วยดันเข้าช่องให้ (corner correction)

/** ขยับแยกแกนทีละไม่เกิน SUBSTEP — ไถลเลียบกำแพงได้ ชนมุมทั้งที่ข้างๆ มีช่อง = เลื่อนเข้าช่องเอง */
export function moveWithCollision(L: LevelView, p: Pos, dx: number, dy: number) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / SUBSTEP))
  for (let i = 0; i < n; i++) stepOnce(L, p, dx / n, dy / n)
}

function stepOnce(L: LevelView, p: Pos, dx: number, dy: number) {
  if (dx) {
    if (!collides(L, p.x + dx, p.y)) p.x += dx
    else if (Math.abs(dy) < Math.abs(dx) * 0.5) nudge(L, p, 'x', dx)
  }
  if (dy) {
    if (!collides(L, p.x, p.y + dy)) p.y += dy
    else if (Math.abs(dx) < Math.abs(dy) * 0.5) nudge(L, p, 'y', dy)
  }
}

function nudge(L: LevelView, p: Pos, axis: 'x' | 'y', d: number) {
  for (let o = 1; o <= NUDGE; o++) {
    for (const s of [1, -1]) {
      const sx = axis === 'y' ? s * o : 0
      const sy = axis === 'x' ? s * o : 0
      const ahead = axis === 'x' ? collides(L, p.x + d, p.y + sy) : collides(L, p.x + sx, p.y + d)
      if (ahead || collides(L, p.x + sx, p.y + sy)) continue
      const m = Math.min(Math.abs(d), o) * s
      if (axis === 'x') p.y += m
      else p.x += m
      return
    }
  }
}
