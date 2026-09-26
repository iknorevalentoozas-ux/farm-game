import type { PlayerView } from '../types'

// วาดคนอื่นย้อนหลังเท่านี้ (ms) — เจ้าตัวส่งตำแหน่งทุก 100ms, server ส่งต่อทุก 100ms บวกเผื่อเน็ตแกว่งอีก ~100ms
const INTERP_MS = 250
const KEEP = 30
// สองจุดห่างกันเกินนี้ = วาร์ป (เริ่มรอบใหม่/โดน correct) ไม่ต้องลากผ่านแผนที่
const SNAP_PX = 150

interface Sample {
  t: number
  x: number
  y: number
}

interface Track {
  samples: Sample[]
  offset: number // นาฬิกาของเจ้าตัว − performance.now() ของเรา
}

/**
 * ตำแหน่งคนอื่นแบบ snapshot interpolation: เก็บ (เวลา, x, y) จาก world:state แล้ววาดที่ "ตอนนี้ − INTERP_MS"
 * โดยลากเส้นระหว่างสองจุดที่คร่อมเวลานั้น
 * **เวลาใช้นาฬิกาของเจ้าตัว** (`ct` = performance.now() ของเครื่องคนนั้นตอนส่ง player:move) ไม่ใช่เวลา server —
 * server รู้ตำแหน่งเฉพาะตอนแพ็กเก็ตมาถึง ถ้าเน็ตเจ้าตัวแกว่ง ตำแหน่งฝั่ง server ก็หยุด-พุ่งตาม ต้องใช้จังหวะที่เดินจริง
 * บอท (ไม่มี ct) ใช้เวลา server ใน world:state แทน
 * offset ต่อคน = max(ct − performance.now()) ของทุกก้อน (ก้อนที่มาเร็วสุดกำหนด) ค่อยๆ ลดลงเผื่อนาฬิกาเดินไม่เท่ากัน
 */
export class RemoteBuffer {
  private tracks = new Map<string, Track>()

  push(serverT: number | undefined, list: PlayerView[], meUuid: string) {
    const local = performance.now()
    const seen = new Set<string>()
    for (const p of list) {
      if (p.uuid === meUuid) continue
      seen.add(p.uuid)
      const st = p.ct ?? serverT ?? Date.now()
      let tr = this.tracks.get(p.uuid)
      const last = tr?.samples[tr.samples.length - 1]
      // นาฬิกาเจ้าตัวถอยหลัง = รีโหลดหน้า/เปลี่ยนจาก bot เป็นคน — เริ่มนับใหม่
      if (!tr || (last && st < last.t - 2000)) this.tracks.set(p.uuid, (tr = { samples: [], offset: st - local }))
      else tr.offset = Math.max(st - local, tr.offset - 0.5)
      const prev = tr.samples[tr.samples.length - 1]
      if (prev && st <= prev.t) {
        // เจ้าตัวไม่ได้ส่งอะไรใหม่ (ยืนอยู่) แต่ตำแหน่งเปลี่ยน = server ย้ายให้ (เริ่มรอบใหม่) → วาร์ปตาม
        if (prev.x !== p.x || prev.y !== p.y) tr.samples = [{ t: st, x: p.x, y: p.y }]
        continue
      }
      tr.samples.push({ t: st, x: p.x, y: p.y })
      if (tr.samples.length > KEEP) tr.samples.shift()
    }
    for (const id of this.tracks.keys()) if (!seen.has(id)) this.tracks.delete(id)
  }

  /** ตำแหน่งที่ควรวาดตอนนี้ — {} ถ้ายังไม่มีข้อมูล (ใช้ค่าจาก world:state ตรงๆ) */
  at(uuid: string): { x?: number; y?: number } {
    const tr = this.tracks.get(uuid)
    const arr = tr?.samples
    if (!tr || !arr?.length) return {}
    const rt = performance.now() + tr.offset - INTERP_MS
    if (rt <= arr[0].t) return { x: arr[0].x, y: arr[0].y }
    for (let i = arr.length - 1; i > 0; i--) {
      const a = arr[i - 1]
      const b = arr[i]
      if (rt < a.t) continue
      if (rt >= b.t) break // เลยจุดล่าสุด = รอข้อมูล ยืนที่เดิม (ไม่เดาต่อ ไม่งั้นเลยแล้วเด้งกลับ)
      if (Math.hypot(b.x - a.x, b.y - a.y) > SNAP_PX) return { x: a.x, y: a.y }
      const k = (rt - a.t) / (b.t - a.t)
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
    const last = arr[arr.length - 1]
    return { x: last.x, y: last.y }
  }

  clear() {
    this.tracks.clear()
  }
}
