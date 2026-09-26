import type { Socket } from 'socket.io-client'
import { Renderer } from './render/Renderer'
import { World, liveStage } from './render/World'
import { Joystick } from './ui/Joystick'
import { Hud, itemLabel, type ActionSet, type Btn } from './ui/Hud'
import { OrdersPanel } from './ui/OrdersPanel'
import { now, syncClock } from './net/clock'
import { moveWithCollision, type LevelView } from './level/collision'
import { listTargets, pickTarget, type Target } from './input/target'
import { computeHint } from './input/hint'
import { createSoundDirector } from './audio/director'
import { RemoteBuffer } from './net/remote'
import type { Catalog, FxEvent, LevelState, OrderView, PlayerView, RoundEnd, RoundView, Snapshot, TeamView } from './types'

// px/sec ที่วาดตัวเองล่วงหน้า — ต้องเท่ากับ SPEED_PPS ใน server/src/world.js (ทั้งคู่คูณ speedMul ของทีม)
const PREDICT_SPEED = 220
const MOVE_SEND_MS = 100

/**
 * ตัวคุมเกมฝั่ง client — สร้างครั้งเดียว: three.js (Renderer/World), HUD, socket listener ทั้งหมด, และ loop
 * รอบใหม่ (round:start) แค่ world.load() ฉากใหม่ ไม่สร้างของพวกนี้ซ้ำ (ไม่งั้น listener ซ้อน)
 *
 * การเดิน: ตัวเราเดินบนจอทันที (ชนกำแพงด้วย collision.ts ชุดเดียวกับ server) แล้วส่งตำแหน่งให้ server
 * พร้อมทิศที่กด — server ตรวจว่าเป็นไปได้แล้วรับ ถ้าไม่ผ่าน (ทะลุกำแพง/ไกลเกิน/รอบใหม่) ตอบ you:correct ให้วาร์ป
 * ไม่มีการดึงตำแหน่งเข้าหา server ต่อเนื่องแล้ว — แบบนั้นบนเน็ตมือถือ ปล่อยจอยแล้วตัวละครไถลต่อ
 * ทุก player:move แนบ cid (เลข you:correct ล่าสุด) ให้ server ทิ้งแพ็กเก็ตที่ส่งก่อนวาร์ป ไม่งั้นวาร์ปเป็นลูกโซ่
 * คนอื่นวาดย้อนหลังเล็กน้อยตามนาฬิกาของเจ้าตัว (t ใน player:move) แล้ว interpolate (net/remote.ts) — เน็ตแกว่งแล้วไม่กระตุก
 */
export function startGame(container: HTMLElement, socket: Socket, snap: Snapshot) {
  const renderer = new Renderer(container)
  const world = new World(renderer)
  const joystick = new Joystick(container)
  const hud = new Hud(container, socket)
  const orders = new OrdersPanel(container)
  const sound = createSoundDirector(snap.you.uuid)

  const meUuid = snap.you.uuid
  const me = { x: snap.you.x, y: snap.you.y, fx: snap.you.fx || 0, fy: snap.you.fy || 1 }
  let cid = snap.you.cid ?? 0
  const remote = new RemoteBuffer()
  let level: LevelView = snap.level
  let state: LevelState = snap.state
  let catalog: Catalog = snap.catalog
  let team: TeamView = snap.team
  let round: RoundView = snap.round
  let players: PlayerView[] = snap.players || [snap.you]
  let orderList: OrderView[] = snap.orders
  let targets = listTargets(level, state)

  function apply(s: Snapshot, fresh: boolean) {
    syncClock(s.serverNow)
    level = s.level
    state = s.state
    catalog = s.catalog
    team = s.team
    round = s.round
    targets = listTargets(level, state)
    Object.assign(me, { x: s.you.x, y: s.you.y })
    cid = s.you.cid ?? 0
    remote.clear()
    hud.setCatalog(catalog)
    hud.setTeam(team)
    hud.setRound(round)
    orders.setCatalog(catalog)
    orderList = s.orders
    orders.set(s.orders)
    world.load(level, catalog, state)
    sound.load(level, s.orders, fresh)
  }
  // คนแรกที่เข้ามาเปิดรอบเอง (ได้ world:snapshot ไม่ใช่ round:start) — ยังไม่มีใครไถดิน = รอบเพิ่งเริ่ม
  apply(snap, snap.round.phase === 'playing' && snap.state.plots.every((p) => p.soil === 'raw'))

  // ต่อใหม่หลังหลุด (เน็ตมือถือ) — server อาจสร้างตัวเราใหม่ที่จุดเกิด/เปลี่ยนรอบไปแล้ว ต้องโหลดใหม่ทั้งก้อน
  // (ครั้งแรกตอนเข้าเกม main.ts รับไปแล้วก่อน listener นี้มี จึงไม่ซ้ำ)
  socket.on('world:snapshot', (s: Snapshot) => apply(s, false))
  socket.on('world:state', ({ t, players: list }: { t?: number; players: PlayerView[] }) => {
    players = list
    remote.push(t, list, meUuid)
  })
  // server ไม่รับตำแหน่งที่เราส่ง (ทะลุกำแพง/เร็วเกิน/เพิ่งขึ้นรอบใหม่) — วาร์ปไปจุดที่ server ถืออยู่
  socket.on('you:correct', ({ x, y, cid: c }: { x: number; y: number; cid?: number }) => {
    me.x = x
    me.y = y
    if (c != null) cid = c
  })
  socket.on('level:state', (s: LevelState) => {
    syncClock(s.serverNow)
    sound.level(state, s)
    state = s
    targets = listTargets(level, state)
    world.setState(s)
  })
  socket.on('farm:team', (t: TeamView) => {
    team = t
    hud.setTeam(t)
  })
  socket.on('farm:toast', ({ text }: { text: string }) => {
    hud.toast(text)
    sound.toast(text)
  })
  socket.on('fx', (e: FxEvent) => {
    world.handleFx(e)
    sound.fx(e)
  })
  socket.on('ui:seeds', () => {
    hud.openSeeds()
    sound.ui('open')
  })
  socket.on('ui:shop', () => {
    hud.openShop()
    sound.ui('open')
  })
  socket.on('chat:message', () => sound.chat())
  socket.on('orders:list', ({ orders: list, serverNow }: { orders: OrderView[]; serverNow: number }) => {
    syncClock(serverNow)
    orderList = list
    orders.set(list)
    sound.orders(list)
  })
  socket.on('round:update', (r: RoundView) => {
    syncClock(r.serverNow)
    sound.round(round, r)
    round = r
    hud.setRound(r)
  })
  socket.on('round:end', (r: RoundEnd) => {
    syncClock(r.serverNow)
    hud.showResults(r)
    sound.roundEnd(r)
  })
  socket.on('round:start', (s: Snapshot) => {
    hud.closeModal()
    apply(s, true)
  })

  // ── คีย์บอร์ด (เดสก์ท็อป) ────────────────────────────────────────────
  const keys = new Set<string>()
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return
    keys.add(e.code)
    if (e.repeat) return
    if (e.code === 'Space' || e.code === 'KeyE') current.primary.enabled && current.primary.run?.()
    if (e.code === 'KeyF' || e.code === 'KeyQ') current.use?.enabled && current.use.run?.()
    if (e.code === 'KeyR' || e.code === 'KeyT') current.throw?.enabled && current.throw.run?.()
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => keys.clear())
  // เสียงคลิกปุ่ม UI (ร้าน/เมล็ด/แชท/ตัวช่วย) — ปุ่มกลม 3 ปุ่มมีเสียงของผลการกระทำอยู่แล้ว
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement)?.closest?.('button, #hud-hint-btn, .hud-sound-btn')
    if (!b || b.classList.contains('act') || (b as HTMLButtonElement).disabled) return
    sound.ui(b.classList.contains('close') ? 'close' : 'click')
  })

  // ── ปุ่มตามบริบท (ต้องตรงกับกติกาใน server/src/actions.js) ──────────
  let current: ActionSet = { primary: { icon: '✋', label: 'หยิบ', enabled: false }, use: null, throw: null }
  function computeActions(t: Target | null): ActionSet {
    const held = players.find((p) => p.uuid === meUuid)?.held ?? null
    const tid = t?.id
    const emit = (ev: string, payload: object = {}) => () => socket.emit(ev, payload)
    const P = (icon: string, label: string, enabled = true): Btn => ({ icon, label, enabled, run: emit('act:primary', { targetId: tid }) })
    const plot = t?.kind === 'plot' ? state.plots.find((p) => p.id === t.id) : undefined
    const stage = plot ? liveStage(plot, state.serverNow, now()) : -1
    const counterItem = t?.kind === 'counter' ? state.counters.find((c) => c.id === t.id)?.item : undefined
    const packer = t?.kind === 'packer' ? state.packers.find((c) => c.id === t.id) : undefined
    const animal = t?.kind === 'animal' ? state.animals?.find((a) => a.id === t.id) : undefined
    const animalDef = animal ? catalog.animals[level.animals.find((a) => a.id === animal.id)!.type] : undefined
    const animalReady = !!animal?.fed && animal.readyAt != null && now() >= animal.readyAt

    let primary: Btn
    if (plot?.pestUntil) primary = P('🐛', 'ไล่แมลง')
    else if (!held) {
      if (counterItem) primary = P(itemLabel(counterItem.k, catalog).emoji, 'หยิบ')
      else if (packer?.item) primary = P('📦', 'หยิบ')
      else if (t?.kind === 'ground') primary = P('✋', 'หยิบ')
      else if (plot && stage === 3) primary = P('🧺', 'เก็บเกี่ยว')
      else if (animal && animalReady) primary = P(catalog.allCrops[animalDef!.product]?.emoji ?? '🧺', 'เก็บ')
      else if (animal) primary = P(animalDef!.emoji, animal.fed ? 'รอแป๊บ' : 'หิวอยู่', false)
      else if (t?.kind === 'seeds') primary = P('🌱', 'เมล็ด')
      else if (t?.kind === 'shop') primary = P('🏪', 'ร้านค้า')
      else primary = P('✋', 'หยิบ', false)
    } else {
      const k = held.k
      const isCrop = k.startsWith('crop:')
      const isTool = k.startsWith('tool:')
      if (!t || t.kind === 'ground') primary = { icon: '⬇️', label: 'วางพื้น', enabled: true, run: emit('act:primary', {}) }
      else if (t.kind === 'counter') primary = P('⬇️', counterItem ? 'โต๊ะเต็ม' : 'วาง', !counterItem)
      else if (t.kind === 'packer') primary = P('📦', 'แพ็ก', isCrop && !packer?.item)
      else if (t.kind === 'animal') primary = P('🌾', 'ให้อาหาร', k.startsWith('feed:') && !animal?.fed)
      else if (t.kind === 'plot') {
        // ถือเมล็ด = ปลูก, ถืออย่างอื่น = วางลงพื้นตรงหน้า (server ทำแบบเดียวกัน)
        if (!k.startsWith('seed:')) primary = P('⬇️', 'วางพื้น')
        else if (plot?.crop) primary = P('🌱', 'มีพืชแล้ว', false)
        else if (plot?.soil !== 'tilled') primary = P('🌱', 'ต้องไถก่อน', false)
        else primary = P('🌱', 'ปลูก')
      }
      else if (t.kind === 'truck') {
        // บอกตั้งแต่ก่อนกดว่าไม่มีออเดอร์รับของชิ้นนี้ (ไม่ต้องเดินมาแล้วค่อยโดนปฏิเสธ)
        const wanted = orderList.some((o) => o.items[k] && o.items[k].have < o.items[k].need)
        primary = !k.startsWith('box:') ? P('🚚', 'ต้องแพ็กก่อน', false) : wanted ? P('🚚', 'ส่งออก') : P('🚚', 'ไม่มีออเดอร์นี้', false)
      }
      else if (t.kind === 'trash') primary = P('🗑️', 'ทิ้ง', !isTool)
      else if (t.kind === 'pond') primary = P('💧', 'เติมน้ำ', k === 'tool:can')
      else if (t.kind === 'shop') primary = P('🪙', 'ขาย', isCrop || k.startsWith('box:'))
      else primary = P('⬇️', 'วาง', false)
    }

    let use: Btn | null = null
    if (held?.k.startsWith('tool:')) {
      const U = (icon: string, label: string, enabled = true): Btn => ({ icon, label, enabled, run: emit('act:use', { targetId: tid }) })
      const tool = held.k.slice(5)
      if (catalog.tools[tool]?.gadget) use = null // ตัวช่วย: วางลงพื้นแล้วทำงานเอง ไม่มีปุ่มใช้
      else if (tool === 'hoe') use = plot && stage !== 3 && !(plot.soil === 'tilled' && !plot.crop) ? U('⛏️', plot.crop ? 'ไถทิ้ง' : 'ไถดิน') : U('⛏️', 'ไถดิน', false)
      else if (tool === 'can') {
        if (t?.kind === 'pond') use = U('💧', 'เติมน้ำ')
        else if (plot && plot.soil === 'tilled' && stage !== 3) use = (held.water ?? 0) > 0 ? U('🚿', 'รดน้ำ') : U('🚿', 'น้ำหมด', false)
        else use = U('🚿', 'รดน้ำ', false)
      } else if (tool === 'sickle') use = U('🔪', 'เกี่ยว', !!plot && stage === 3)
    }
    const thr: Btn | null = held ? { icon: '↗️', label: 'โยน', enabled: true, run: emit('act:throw') } : null
    return { primary, use, throw: thr }
  }

  // ── ตัวช่วยนำทาง (ลูกศร + ข้อความ) — คิดใหม่ 5 ครั้ง/วิ พอ ─────────────
  let hintAccum = 1000
  function updateHint(dtMs: number, playing: boolean) {
    hintAccum += dtMs
    if (hintAccum < 200) return
    hintAccum = 0
    const held = players.find((p) => p.uuid === meUuid)?.held ?? null
    const h = playing && hud.hintsOn ? computeHint({ level, state, orders: orderList, players, catalog, me, held, now: now() }) : null
    // อยู่ใกล้แล้ว วงไฮไลต์บอกพอ ไม่ต้องมีลูกศรบังของ
    world.setHint(h && Math.hypot(h.x - me.x, h.y - me.y) > 100 ? h : null)
    hud.setTip(h?.text ?? '')
  }

  // ── loop ─────────────────────────────────────────────────────────────
  let moveAccum = 0
  let lastDx = 0
  let lastDy = 0
  function step(dtMs: number) {
    const dt = Math.min(dtMs, 100) / 1000
    const playing = round.phase === 'playing'
    let dx = 0
    let dy = 0
    if (playing && joystick.active) {
      dx = joystick.dx
      dy = joystick.dy
    } else if (playing && !hud.modalOpen) {
      if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1
      if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1
      if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1
      if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1
      const len = Math.hypot(dx, dy)
      if (len > 1) {
        dx /= len
        dy /= len
      }
    }
    const moving = dx !== 0 || dy !== 0
    const px = me.x
    const py = me.y
    if (moving) {
      const s = PREDICT_SPEED * (team.speedMul || 1) * dt
      moveWithCollision(level, me, dx * s, dy * s)
      const l = Math.hypot(dx, dy)
      me.fx = dx / l
      me.fy = dy / l
    }
    moveAccum += dtMs
    const changed = Math.abs(dx - lastDx) > 0.05 || Math.abs(dy - lastDy) > 0.05
    if (changed || (moving && moveAccum >= MOVE_SEND_MS)) {
      moveAccum = 0
      lastDx = dx
      lastDy = dy
      socket.emit('player:move', { dx, dy, x: me.x, y: me.y, cid, t: Math.round(performance.now()) })
    }

    const target = playing ? pickTarget(targets, me, me.fx, me.fy) : null
    current = playing ? computeActions(target) : { primary: { icon: '✋', label: 'หยิบ', enabled: false }, use: null, throw: null }
    hud.setActions(current)
    updateHint(dtMs, playing)
    hud.renderStats(players.find((p) => p.uuid === meUuid)?.held ?? null)

    // ผู้เล่นทุกคน (ของเราใช้ตำแหน่งที่วาดล่วงหน้า + ทิศล่าสุด)
    const view = players.map((p) => (p.uuid === meUuid ? { ...p, fx: me.fx, fy: me.fy } : { ...p, ...remote.at(p.uuid) }))
    const raining = round.event?.type === 'rain' && round.event.until > now()
    world.update(dt, now(), view, meUuid, me, target, !!raining)
    sound.held(players.find((p) => p.uuid === meUuid)?.held ?? null)
    sound.frame({ dt, now: now(), pos: me, movedPx: Math.hypot(me.x - px, me.y - py), state, players, round, raining: !!raining })
    renderer.render()
  }

  // สำหรับทดสอบใน Browser pane: requestAnimationFrame หยุดเมื่อหน้าต่างอยู่ด้านหลัง จึงให้สคริปต์เรียก
  // __farm.step() เอง — ตั้ง __farm.manual = true ก่อน ไม่งั้น loop จริงกับสคริปต์จะเดินเกมซ้อนกันสองเท่า
  const debug = { step, me, sound, joystick, hud, world, renderer, socket, manual: false, get state() { return state }, get players() { return players }, get level() { return level }, get round() { return round } }
  ;(window as unknown as { __farm: unknown }).__farm = debug

  let last = performance.now()
  const frame = (t: number) => {
    if (!debug.manual) step(t - last)
    last = t
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
