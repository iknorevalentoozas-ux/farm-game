import { ac, buses, hiss, tone } from './engine'
import { SFX, resultsJingle } from './sfx'
import { music } from './music'
import { liveStage } from '../render/World'
import type { LevelView, Theme } from '../level/collision'
import type { FxEvent, ItemView, LevelState, OrderView, PlayerView, RoundEnd, RoundView } from '../types'

/**
 * ผู้กำกับเสียง — game.ts ส่งข้อมูลจาก socket/เฟรมมา แล้วตัวนี้ตัดสินว่าจะดังอะไร
 * ไม่ต้องแก้ server: ฟังจาก fx ที่ server ส่งอยู่แล้ว + เทียบ state ก่อน/หลัง
 * (ของในมือเรา, ออเดอร์, จุดแพ็ก, สัตว์, แปลงที่เพิ่งโตเสร็จ, เหตุการณ์, เวลา)
 *
 * เสียงในฉากมีตำแหน่ง: ไกลตัวเราเบาลง + ซ้าย/ขวาตามแกน x (กล้องมองไปทาง −z แกน x ตรงกับจอ)
 */
type Pos = { x: number; y: number }

const NEAR = 260 // px — ใกล้กว่านี้ดังเต็ม
const FAR = 900 // px — ไกลกว่านี้เบาสุด (ยังได้ยินนิดๆ ให้รู้ว่าเพื่อนทำอะไรอยู่)
const STEP_PX = 38 // เดินกี่ px ต่อ 1 ก้าว
const WORK_SOUND: Record<string, [name: string, everySec: number]> = { till: ['dig', 0.3], water: ['pour', 0.22], reap: ['swish', 0.2] }
const FX_SOUND: Partial<Record<FxEvent['type'], string>> = {
  splash: 'splash', water: 'water', harvest: 'harvest', plant: 'plant', dust: 'tilled', shoo: 'shoo',
  trash: 'trash', coins: 'complete', feed: 'feed', spray: 'spray', bees: 'bees', gift: 'gift',
}

const haveSum = (o: OrderView) => Object.values(o.items).reduce((s, it) => s + it.have, 0)

export type SoundDirector = ReturnType<typeof createSoundDirector>

export function createSoundDirector(meUuid: string) {
  const last = new Map<string, number>() // กันเสียงเดียวกันซ้อนรัว
  let me: Pos = { x: 0, y: 0 }
  let level: LevelView | null = null
  let theme: Theme = 'grass'
  let recentNear = 0 // เวลาที่เสียงการกระทำใกล้ตัวดังล่าสุด — ไม่ให้ป๊อปหยิบของซ้อนเสียงเก็บเกี่ยว/ส่งของ
  let heldKey: string | null | undefined
  let stepDist = 0
  let stepAlt = false
  let workAcc = 0
  let lastSec = -1
  // ของที่แจ้งไปแล้ว (แพ็กเสร็จ/สัตว์ทำของเสร็จ/แปลงโตเสร็จ) — ล้างตอนโหลดรอบ แล้วเฟรมแรกจำไว้เงียบๆ
  const done = new Set<string>()
  let primed = false
  let orderIds = new Set<number>()
  let orderHave = new Map<number, number>()
  let rain: { src: AudioBufferSourceNode; g: GainNode } | null = null

  const spot = (id: string): Pos | null =>
    level?.plots.find((q) => q.id === id) ?? level?.packers.find((q) => q.id === id) ?? null

  function play(name: string, at?: Pos | null, vol = 1, gapMs = 40) {
    const c = ac()
    const fn = SFX[name]
    if (!c || !fn) return
    const t = performance.now()
    if (t - (last.get(name) ?? -1e9) < gapMs) return
    last.set(name, t)
    let pan = 0
    if (at) {
      const dx = at.x - me.x
      const dist = Math.hypot(dx, at.y - me.y)
      vol *= dist <= NEAR ? 1 : Math.max(0.18, 1 - (dist - NEAR) / (FAR - NEAR))
      pan = Math.max(-0.7, Math.min(0.7, dx / 600))
      if (dist <= NEAR) recentNear = t
    }
    const g = c.createGain()
    g.gain.value = vol
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner()
      p.pan.value = pan
      g.connect(p).connect(buses().sfx)
    } else g.connect(buses().sfx)
    fn(c, g)
  }

  /** ฝีเท้า: หญ้า = ตุบนุ่ม, ทราย = ซ่าทุ้ม, หิมะ = กรอบแกรบ + ตุ๊บเล็กๆ ให้ตัวกลมๆ ดูเด้งดึ๋ง */
  function footstep() {
    const c = ac()
    if (!c) return
    const d = buses().sfx
    stepAlt = !stepAlt
    const k = stepAlt ? 1 : 0.86
    const f = theme === 'snow' ? 3400 : theme === 'desert' ? 1000 : 700
    hiss(c, d, { dur: theme === 'snow' ? 0.07 : 0.05, vol: theme === 'snow' ? 0.06 : 0.07, f: f * k, q: 1.2 })
    tone(c, d, { f: 210 * k, f2: 90, dur: 0.06, vol: 0.06 })
  }

  function setRain(on: boolean) {
    const c = ac()
    if (on && !rain && c) {
      const src = c.createBufferSource()
      src.buffer = rainBuffer(c)
      src.loop = true
      const f = c.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = 1800
      f.Q.value = 0.6
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, c.currentTime)
      g.gain.exponentialRampToValueAtTime(0.09, c.currentTime + 1.2)
      src.connect(f).connect(g).connect(buses().sfx)
      src.start()
      rain = { src, g }
    } else if (!on && rain) {
      const { src, g } = rain
      rain = null
      const t = g.context.currentTime
      g.gain.setTargetAtTime(0.0001, t, 0.4)
      src.stop(t + 2)
    }
  }

  return {
    /** เริ่มรอบ (หรือเข้ามากลางรอบ): เปลี่ยนเพลงตามธีม ล้างสิ่งที่จำไว้ · fresh = รอบเพิ่งเริ่ม → เสียงนับ 3-2-1 */
    load(lv: LevelView, orders: OrderView[], fresh: boolean) {
      level = lv
      theme = lv.theme
      done.clear()
      primed = false
      orderIds = new Set(orders.map((o) => o.id))
      orderHave = new Map(orders.map((o) => [o.id, haveSum(o)]))
      lastSec = -1
      heldKey = undefined // มือว่างตอนรอบใหม่ ไม่ต้องดังป๋อม
      setRain(false)
      music.play(lv.theme)
      if (fresh) play('go')
    },

    fx(e: FxEvent) {
      if (e.type === 'throw') {
        play('whoosh', e.from)
        const to = e.to
        if (to) setTimeout(() => play('thud', to, 1, 0), 400)
        return
      }
      const name = FX_SOUND[e.type]
      if (!name) return
      const at = e.x != null && e.y != null ? { x: e.x, y: e.y } : null
      // สปริงเกลอร์พ่นทุก 4 วิ — ดังเฉพาะตอนอยู่ใกล้ ไม่งั้นทั้งแผนที่ซ่าตลอด
      if (e.type === 'spray' && (!at || Math.hypot(at.x - me.x, at.y - me.y) > NEAR * 1.3)) return
      play(name, e.type === 'coins' ? null : at, 1, e.type === 'bees' ? 120 : 40)
    },

    /** ของในมือเราเปลี่ยน — หยิบ = ป๊อป, ถุงเมล็ด = กรอบแกรบ, วาง = ป๋อม (ถ้าการกระทำนี้ยังไม่มีเสียงอื่น) */
    held(h: ItemView | null) {
      const k = h ? h.k : null
      if (heldKey === undefined) heldKey = k
      if (k === heldKey) return
      const prev = heldKey
      heldKey = k
      if (performance.now() - recentNear < 350) return
      if (k && (k.startsWith('seed:') || k.startsWith('feed:'))) play('rustle')
      else if (k) play('pop')
      else if (prev) play('plop')
    },

    level(prev: LevelState, next: LevelState) {
      for (const p of next.packers) {
        const was = prev.packers.find((q) => q.id === p.id)
        if (p.item && p.readyAt && was?.readyAt !== p.readyAt) play('pack', spot(p.id))
      }
      for (const p of next.plots) {
        const was = prev.plots.find((q) => q.id === p.id)
        if (p.pestUntil && !was?.pestUntil) play('pests', spot(p.id), 0.8, 200)
      }
    },

    orders(list: OrderView[]) {
      let fresh = false
      let delivered = false
      for (const o of list) {
        if (!orderIds.has(o.id)) fresh = true
        else if (haveSum(o) > (orderHave.get(o.id) ?? 0)) delivered = true
      }
      orderIds = new Set(list.map((o) => o.id))
      orderHave = new Map(list.map((o) => [o.id, haveSum(o)]))
      if (delivered) play('deliver')
      if (fresh) play('order', null, 1, 300)
    },

    round(prev: RoundView, next: RoundView) {
      if (next.id !== prev.id) return
      if (next.failed > prev.failed) play('expired')
      const ev = next.event
      if (ev && (ev.type !== prev.event?.type || ev.until !== prev.event?.until)) play(`ev_${ev.type}`)
    },

    roundEnd(r: RoundEnd) {
      setRain(false)
      music.setHurry(false)
      play('timeup')
      music.play('results')
      resultsJingle(r.stars, r.newBest)
    },

    toast(text: string) {
      if (text.startsWith('🐛 แมลงกินพืช')) return play('expired', null, 0.7)
      if (text.includes('หุ่นไล่กา')) return play('shoo')
      if (/^(🎉|🤝)/u.test(text)) return play('buy')
      // ✅ ⏰ = coins fx / round:update, เหตุการณ์สุ่ม = เสียงเปิดเหตุการณ์จาก round:update — ไม่ใช่ข้อความเตือน
      if (/^(✅|⏰|🌧|🐛|🐝|🎁|🛒|⚡)/u.test(text)) return
      if (text.startsWith('ขายได้')) return play('coin')
      play('error', null, 1, 250)
    },

    chat: () => play('chat', null, 1, 150),
    ui: (name: 'click' | 'open' | 'close') => play(name, null, 1, 60),

    /** ทุกเฟรม: ฝีเท้า, เสียงระหว่างทำงาน, ของที่เพิ่งเสร็จเอง, นับถอยหลัง 10 วิ, เพลงเร่ง, ฝน */
    frame(o: { dt: number; now: number; pos: Pos; movedPx: number; state: LevelState; players: PlayerView[]; round: RoundView; raining: boolean }) {
      me = { x: o.pos.x, y: o.pos.y }
      const playing = o.round.phase === 'playing'

      if (o.movedPx > 0) {
        stepDist += o.movedPx
        if (stepDist >= STEP_PX) {
          stepDist = 0
          footstep()
        }
      } else stepDist = STEP_PX * 0.6 // หยุดแล้วเดินใหม่ ก้าวแรกดังเร็ว

      const w = o.players.find((p) => p.uuid === meUuid)?.work
      const ws = w && w.until > o.now ? WORK_SOUND[w.kind] : null
      if (ws) {
        workAcc += o.dt
        if (workAcc >= ws[1]) {
          workAcc = 0
          play(ws[0])
        }
      } else workAcc = 1 // เริ่มงานใหม่ ดังทันที

      // สิ่งที่เสร็จเองตามเวลา — ไม่มี event จาก server เลยจับตอนเวลาผ่านจุดเสร็จ (เฉพาะที่อยู่ใกล้ๆ)
      const notify = (key: string, at: Pos | null | undefined, sound: string, maxDist: number) => {
        if (done.has(key)) return
        done.add(key)
        if (primed && at && Math.hypot(at.x - me.x, at.y - me.y) <= maxDist) play(sound, at, 1, 120)
      }
      for (const p of o.state.packers) {
        if (p.item && p.readyAt && o.now >= p.readyAt) notify(`k${p.id}:${p.readyAt}`, spot(p.id), 'packed', 700)
      }
      for (const a of o.state.animals || []) {
        if (!a.fed || !a.readyAt || o.now < a.readyAt) continue
        const def = level?.animals.find((q) => q.id === a.id)
        notify(`a${a.id}:${a.readyAt}`, def, def?.type === 'cow' ? 'moo' : 'cluck', 800)
      }
      for (const p of o.state.plots) {
        const key = `p${p.id}`
        if (!p.crop) done.delete(key) // แปลงว่างแล้ว — ปลูกรอบหน้าจะได้ดังอีก
        else if (liveStage(p, o.state.serverNow, o.now) === 3) notify(key, spot(p.id), 'ready', 320)
      }
      primed = true

      if (playing) {
        const left = Math.ceil((o.round.endsAt - o.now) / 1000)
        if (left !== lastSec && lastSec !== -1 && left >= 1 && left <= 10) play(left <= 3 ? 'tock' : 'tick')
        lastSec = left
        music.setHurry(left <= 30 && left > 0)
      }
      setRain(playing && o.raining)
    },
  }
}

let rainBuf: AudioBuffer | null = null
/** noise ปนเม็ดฝนกระทบเป็นจุดๆ (วนลูป 3 วิ) */
function rainBuffer(c: AudioContext) {
  if (rainBuf) return rainBuf
  rainBuf = c.createBuffer(1, c.sampleRate * 3, c.sampleRate)
  const d = rainBuf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5
  for (let n = 0; n < 90; n++) {
    const at = Math.floor(Math.random() * (d.length - 800))
    const f = 2000 + Math.random() * 3000
    for (let j = 0; j < 600; j++) d[at + j] += Math.sin((j / c.sampleRate) * f * Math.PI * 2) * Math.exp(-j / 120) * 0.9
  }
  return rainBuf
}
