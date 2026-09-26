import type { LevelView, Theme } from './level/collision'

export interface ItemView {
  k: string // 'seed:carrot' | 'crop:carrot' | 'box:carrot' | 'feed:grain' | 'tool:hoe|can|sickle|sprinkler|scarecrow'
  water?: number
  n?: number // ถุงเมล็ด/อาหารสัตว์ใบใหญ่: ใช้ได้อีกกี่ครั้ง
}

export interface WorkView {
  targetId: string
  kind: 'till' | 'water' | 'reap'
  until: number
  total: number
}

export interface PlayerView {
  uuid: string
  name: string
  x: number
  y: number
  fx: number
  fy: number
  color: number
  held: ItemView | null
  work: WorkView | null
  /** เลข you:correct ล่าสุดของคนนี้ — client แนบไปกับ player:move (ดู server/src/world.js) */
  cid?: number
  /** performance.now() ของเครื่องเจ้าตัวตอนอยู่ที่ x,y (ไม่มี = บอท) — net/remote.ts ใช้ interpolate */
  ct?: number
}

export interface PlotState {
  id: string
  soil: 'raw' | 'tilled'
  crop: string | null
  progressMs: number // ณ serverNow ของ level:state นั้น
  growMs: number
  moistUntil: number
  pestUntil: number | null
}

export interface LevelState {
  plots: PlotState[]
  counters: { id: string; item: ItemView | null }[]
  packers: { id: string; item: ItemView | null; readyAt: number | null; total: number }[]
  animals: { id: string; fed: boolean; readyAt: number | null; total: number }[]
  ground: { id: string; x: number; y: number; item: ItemView }[]
  serverNow: number
}

export interface CropDef {
  id: string
  name: string
  emoji: string
  growMs: number
  seed: number
  sell: number
  order: number
  animal?: string
}

export interface Catalog {
  crops: Record<string, CropDef> // พืชของแผนที่นี้ (growMs ปรับตามแผนที่แล้ว)
  cropOrder: string[]
  products: string[] // ของจากสัตว์ในแผนที่นี้ (egg/milk)
  allCrops: Record<string, CropDef>
  animals: Record<string, { id: string; name: string; emoji: string; product: string }>
  tools: Record<string, { id: string; name: string; emoji: string; gadget?: boolean }>
}

export interface ShopItem {
  id: string
  emoji: string
  name: string
  desc: string
  price: number | null
  free?: boolean // ทีมเล็กได้ฟรีอยู่ตอนนี้
}

export interface TeamView {
  coins: number
  canCap: number
  speedMul: number
  fertilizer: boolean
  upgrades: string[]
  sellMul: number
  shop: ShopItem[]
}

export interface OrderView {
  id: number
  items: Record<string, { need: number; have: number }>
  reward: number
  expiresAt: number
  totalSec: number
  rush: boolean
}

export type EventType = 'rain' | 'pests' | 'rush' | 'bees' | 'gift' | 'market'

export interface RoundView {
  id: number
  phase: 'idle' | 'playing' | 'results'
  endsAt: number
  mapId: string
  mapName: string
  theme: Theme
  stars: number[] // เกณฑ์ดาวที่ปรับตามจำนวนคนแล้ว
  players: number // จำนวนคนเฉลี่ยในรอบ (ที่ใช้ปรับดาว)
  score: number
  completed: number
  failed: number
  event: { type: EventType; until: number } | null
  assist: string[] // ตัวช่วยฟรีของทีมเล็กรอบนี้ (id ในร้าน)
  best: number
  serverNow: number
}

export interface RoundEnd {
  score: number
  stars: number
  thresholds: number[]
  players: number
  completed: number
  failed: number
  best: number
  newBest: boolean
  mapName: string
  nextMapName: string
  nextAt: number
  serverNow: number
}

export interface Snapshot {
  you: PlayerView
  players?: PlayerView[]
  level: LevelView
  state: LevelState
  round: RoundView
  team: TeamView
  catalog: Catalog
  orders: OrderView[]
  serverNow: number
}

export interface FxEvent {
  type: 'throw' | 'splash' | 'water' | 'harvest' | 'plant' | 'dust' | 'shoo' | 'trash' | 'coins' | 'feed' | 'spray' | 'bees' | 'gift'
  x?: number
  y?: number
  from?: { x: number; y: number }
  to?: { x: number; y: number }
  k?: string
  amount?: number
}
