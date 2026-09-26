import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { Renderer, toWorld } from './Renderer'
import { Fx } from './fx'
import * as M from './models'
import { use } from './overrides'
import type { LevelView } from '../level/collision'
import type { Catalog, FxEvent, LevelState, PlayerView, PlotState } from '../types'
import type { Target } from '../input/target'

interface PlayerRig {
  char: M.Character
  label: CSS2DObject
  bar: CSS2DObject
  heldK: string | null
  heldObj: THREE.Object3D | null
  pos: THREE.Vector3 // ตำแหน่งที่วาดจริง (lerp เข้าหาเป้าหมาย)
  target: THREE.Vector3
  yaw: number
  walkT: number
  color: number
  blinkAt: number
}

interface AnimalView {
  rig: M.AnimalRig
  icon: CSS2DObject
  bar: CSS2DObject
  phase: number
  sig: string
}

/** ระยะโตสดของแปลง (สูตรเดียวกับ server settlePlot) — -1 ว่าง, 0..2 โต, 3 พร้อมเก็บ */
export function liveStage(p: PlotState, stateTime: number, now: number) {
  if (!p.crop) return -1
  const prog = p.progressMs + Math.max(0, Math.min(now, p.moistUntil) - stateTime)
  if (prog >= p.growMs) return 3
  return Math.max(0, Math.min(2, Math.floor((prog / p.growMs) * 3)))
}

function label(html: string, cls: string) {
  const el = document.createElement('div')
  el.className = cls
  el.innerHTML = html
  return new CSS2DObject(el)
}

const easeOutBack = (t: number) => {
  const c = 1.9
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

/**
 * ฉากของรอบหนึ่ง: ส่วนนิ่ง (พื้น รั้ว ต้นไม้ สถานี) สร้างครั้งเดียวแล้วรวม geometry, ส่วนที่เปลี่ยน
 * (แปลง ของบนโต๊ะ/พื้น สัตว์ ผู้เล่น) อัปเดตจาก level:state / world:state ทุกเฟรม
 * ของที่โผล่ใหม่เด้งขึ้น (pop), ตัวละครกระพริบตา/หายใจ, มีผีเสื้อ (หรือหิมะ) และเป็ดในบ่อให้ฉากมีชีวิต
 */
export class World {
  readonly fx: Fx
  private root = new THREE.Group()
  private level!: LevelView
  private catalog!: Catalog
  private state!: LevelState
  private stateTime = 0 // serverNow ของ level:state ล่าสุด
  private plots = new Map<string, { group: THREE.Group; sig: string; icon: CSS2DObject }>()
  private slotItems = new Map<string, { k: string; obj: THREE.Object3D }>() // counters + packers
  private packBars = new Map<string, CSS2DObject>()
  private groundItems = new Map<string, { k: string; obj: THREE.Object3D }>()
  private animals = new Map<string, AnimalView>()
  private players = new Map<string, PlayerRig>()
  private pops: { obj: THREE.Object3D; t: number; base: number }[] = []
  private ambient: { obj: THREE.Object3D; home: THREE.Vector3; phase: number; speed: number }[] = []
  private duck: THREE.Object3D | null = null
  private duckHome = new THREE.Vector3()
  private ring: THREE.Mesh
  private arrow: THREE.Group
  private clock = 0

  constructor(private r: Renderer) {
    this.fx = new Fx(r.scene)
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.44, 0.56, 32),
      new THREE.MeshBasicMaterial({ color: '#fff8d6', transparent: true, opacity: 0.9, depthWrite: false }),
    )
    this.ring.rotation.x = -Math.PI / 2
    this.ring.renderOrder = 5
    // ลูกศรนำทาง: ชี้ที่ที่ควรไปต่อ (Hud/game.ts เป็นคนเลือกเป้า)
    const arrowMat = new THREE.MeshBasicMaterial({ color: '#ffd23f' })
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.26, 12), arrowMat)
    tip.rotation.x = Math.PI
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), arrowMat)
    stem.position.y = 0.22
    const outline = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.32, 12), new THREE.MeshBasicMaterial({ color: '#8a5a14', side: THREE.BackSide }))
    outline.rotation.x = Math.PI
    this.arrow = new THREE.Group()
    this.arrow.add(tip, stem, outline)
    this.arrow.visible = false
  }

  load(level: LevelView, catalog: Catalog, state: LevelState) {
    this.dispose()
    this.level = level
    this.catalog = catalog
    this.r.scene.add(this.root)
    this.root.add(this.ring, this.arrow)
    this.r.setLevel(level.cols, level.rows, level.theme)
    this.buildStatic()
    for (const p of level.plots) {
      const icon = label('', 'plot-icon')
      icon.position.set(toWorld(p.x), 0.9, toWorld(p.y))
      this.root.add(icon)
      this.plots.set(p.id, { group: new THREE.Group(), sig: '', icon })
    }
    for (const a of level.animals || []) {
      const rig = M.animal(a.type)
      rig.root.position.set(toWorld(a.x), 0, toWorld(a.y))
      rig.root.rotation.y = ((a.x * 7 + a.y * 3) % 5) * 0.3 - 0.6
      this.root.add(rig.root)
      const icon = label('', 'plot-icon')
      icon.position.set(toWorld(a.x), a.type === 'cow' ? 1.25 : 1.0, toWorld(a.y))
      const bar = label('<div class="fill"></div>', 'work-bar')
      bar.position.set(toWorld(a.x), a.type === 'cow' ? 1.05 : 0.85, toWorld(a.y))
      bar.visible = false
      this.root.add(icon, bar)
      this.animals.set(a.id, { rig, icon, bar, phase: Math.random() * 10, sig: '' })
    }
    this.setState(state)
  }

  private at(px: number, py: number, obj: THREE.Object3D, y = 0) {
    obj.position.set(toWorld(px), y, toWorld(py))
    return obj
  }

  private pop(obj: THREE.Object3D, base = obj.scale.x) {
    obj.scale.setScalar(0.01)
    this.pops.push({ obj, t: 0, base })
  }

  private buildStatic() {
    const L = this.level
    const theme = L.theme
    const stat = new THREE.Group()
    const S = (px: number) => toWorld(px)
    const dark = { grass: M.PALETTE.grassDark, spring: M.PALETTE.springDark, desert: M.PALETTE.desertDark, snow: M.PALETTE.snowDark }[theme]
    // พื้นรอบนอกแผนที่ + ต้นไม้ไกลๆ ให้ฉากมีความลึก ไม่ลอยอยู่กลางความว่าง
    const outer = new THREE.Mesh(new THREE.BoxGeometry(L.cols + 40, 0.2, L.rows + 40), M.mat(dark))
    outer.position.set(L.cols / 2, -0.3, L.rows / 2) // ต่ำกว่าผิวน้ำบ่อ (-0.03) ไม่งั้นบังบ่อมิด
    outer.receiveShadow = true
    stat.add(outer)
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2
      const rad = Math.max(L.cols, L.rows) / 2 + 2.5 + (i % 3) * 1.3
      const t = use(`tree-${theme}`, () => M.tree(theme))
      t.position.set(L.cols / 2 + Math.cos(a) * rad * 1.1, 0, L.rows / 2 + Math.sin(a) * rad * 0.9)
      t.scale.setScalar(0.9 + ((i * 37) % 10) / 20)
      stat.add(t)
    }

    const truckTiles: { x: number; z: number }[] = []
    let pondN = 0
    L.tiles.forEach((row, r) => {
      ;[...row].forEach((ch, c) => {
        const x = c + 0.5
        const z = r + 0.5
        // บวกเพิ่มจากตำแหน่งเดิมของโมเดล ห้าม set ทับ — โมเดลบางชิ้นมีระยะชดเชยของตัวเอง (พื้น y=-0.1,
        // ของตกแต่งเยื้อง x/z) ถ้า set ทับ พื้นจะลอยขึ้นมาบังแปลงดินจนมองไม่เห็น
        const place = (o: THREE.Object3D, y = 0) => {
          o.position.x += x
          o.position.y += y
          o.position.z += z
          stat.add(o)
        }
        if (ch !== 'W') place(M.groundTile(theme, r * 31 + c * 17, (r + c) % 2))
        if (ch === '.' || ch === '@') {
          const d = M.decor(theme, r * 131 + c * 71)
          if (d) place(d)
        }
        if (ch === '#') place(use('fence', () => M.fence()))
        else if (ch === 'T') place(use(`tree-${theme}`, () => M.tree(theme)))
        else if (ch === 'W') {
          place(use('water', () => M.pond(r * 13 + c)))
          if (!pondN++) this.duckHome.set(x, 0, z)
        } else if (ch === 'C') place(use('counter', () => M.counter(false)))
        else if (ch === 'R') place(use('rack', () => M.counter(true)))
        else if (ch === 'K') place(use('pack', () => M.packStation()))
        else if (ch === 'D') place(use('seeds', () => M.seedBox(this.catalog.cropOrder)))
        else if (ch === 'G') place(use('trash', () => M.trashBin()))
        else if (ch === 'S') place(use('shop', () => M.shop()))
        else if (ch === 'B') truckTiles.push({ x, z })
      })
    })
    // รถคันเดียวคร่อมช่อง B ที่ติดกัน (แผนที่มี B 2 ช่องต่อกัน)
    if (truckTiles.length) {
      const cx = truckTiles.reduce((a, t) => a + t.x, 0) / truckTiles.length
      const cz = truckTiles.reduce((a, t) => a + t.z, 0) / truckTiles.length
      const vertical = truckTiles.length > 1 && truckTiles[0].x === truckTiles[1].x
      const t = use('truck', () => M.truck())
      t.position.set(cx, 0, cz)
      if (!vertical) t.rotation.y = Math.PI / 2
      stat.add(t)
    }
    this.root.add(Renderer.mergeStatic(stat))

    if (pondN) {
      this.duck = use('duck', () => M.duck())
      this.duck.position.copy(this.duckHome)
      this.root.add(this.duck)
    }
    this.buildAmbient()

    // ป้ายชื่อสถานี (DOM ลอย)
    const tags: Record<string, string> = { S: '🏪 ร้านค้า', D: '🌱 เมล็ด', B: '🚚 ส่งออก', G: '🗑️ ขยะ' }
    const seen = new Set<string>()
    for (const st of L.stations) {
      if (!tags[st.type] || seen.has(st.type)) continue
      seen.add(st.type)
      const t = label(tags[st.type], 'station-tag')
      t.position.set(S(st.x), st.type === 'S' ? 2.0 : 1.3, S(st.y))
      this.root.add(t)
    }
    if (L.packers[0]) {
      const t = label('📦 แพ็ก', 'station-tag')
      t.position.set(S(L.packers[0].x), 1.4, S(L.packers[0].y))
      this.root.add(t)
    }
  }

  /** ผีเสื้อบินวน (หญ้า/ซากุระ) หรือเกล็ดหิมะร่วง (หิมะ) — แค่ของตกแต่ง ไม่มีผลกับเกม */
  private buildAmbient() {
    const L = this.level
    const theme = L.theme
    if (theme === 'desert') return
    const n = theme === 'snow' ? 40 : 7
    for (let i = 0; i < n; i++) {
      const home = new THREE.Vector3(1 + Math.random() * (L.cols - 2), theme === 'snow' ? Math.random() * 6 : 0.6 + Math.random() * 0.5, 1 + Math.random() * (L.rows - 2))
      let obj: THREE.Object3D
      if (theme === 'snow') {
        obj = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
      } else {
        const col = ['#ffd84a', '#ff9fc2', '#8fd3ff', '#ffffff', '#c3a6ff'][i % 5]
        const wingMat = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })
        const wing = new THREE.CircleGeometry(0.08, 10)
        const l = new THREE.Mesh(wing, wingMat)
        const r = new THREE.Mesh(wing, wingMat)
        l.position.x = -0.06
        r.position.x = 0.06
        const g = new THREE.Group()
        const wl = new THREE.Group()
        const wr = new THREE.Group()
        wl.add(l)
        wr.add(r)
        g.add(wl, wr, new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.06, 2, 6), new THREE.MeshBasicMaterial({ color: '#4a3a40' })))
        g.children[2].rotation.x = Math.PI / 2
        g.userData.wings = [wl, wr]
        obj = g
      }
      obj.position.copy(home)
      this.root.add(obj)
      this.ambient.push({ obj, home, phase: Math.random() * 100, speed: 0.5 + Math.random() * 0.6 })
    }
  }

  setState(state: LevelState) {
    this.state = state
    this.stateTime = state.serverNow
  }

  catalogOf() {
    return this.catalog
  }

  handleFx(e: FxEvent) {
    const P = (x = 0, y = 0, h = 0.4) => new THREE.Vector3(toWorld(x), h, toWorld(y))
    const X = toWorld(e.x || 0)
    const Z = toWorld(e.y || 0)
    switch (e.type) {
      case 'throw':
        if (e.from && e.to && e.k) this.fx.throwArc(e.k, P(e.from.x, e.from.y, 0.8), P(e.to.x, e.to.y, 0.1))
        break
      case 'water':
      case 'splash':
        this.fx.burst(X, Z, '#7fd0f5', 14, 1.4)
        break
      case 'spray':
        this.fx.burst(X, Z, '#9fdcff', 18, 2.2, 0.4)
        break
      case 'dust':
        this.fx.burst(X, Z, '#c9955f', 12, 1.2, 0.15)
        break
      case 'harvest':
        this.fx.burst(X, Z, '#ffe066', 12, 2, 0.3, 'star')
        break
      case 'plant':
        this.fx.burst(X, Z, '#7ed957', 8, 1, 0.3, 'leaf')
        break
      case 'feed':
        this.fx.burst(X, Z, '#ff7fa8', 6, 1.2, 0.8, 'heart')
        break
      case 'bees':
        this.fx.burst(X, Z, '#ffd23f', 8, 1.6, 0.5, 'star')
        this.fx.floatText('🐝', P(e.x, e.y, 1.0), '#ffd23f')
        break
      case 'gift':
        this.fx.drop(e.k || 'box:carrot', P(e.x, e.y, 6), P(e.x, e.y, 0.05))
        this.fx.burst(X, Z, '#ff9fc2', 14, 2.2, 0.2, 'star')
        break
      case 'shoo':
        this.fx.burst(X, Z, '#555555', 10, 2.4)
        break
      case 'trash':
        this.fx.burst(X, Z, '#9aa0a6', 10, 1.4, 0.7)
        break
      case 'coins':
        if (e.x != null) this.fx.floatText(`+${e.amount} 🪙`, P(e.x, e.y, 1.8))
        this.fx.burst(X, Z, '#ffd84a', 16, 2.4, 1, 'star')
        this.fx.burst(X, Z, '#ff7fa8', 6, 1.6, 1.2, 'heart')
        break
    }
  }

  /** ลูกศรนำทางเหนือเป้าหมายที่ควรไปต่อ (null = ซ่อน) */
  setHint(pos: { x: number; y: number; h?: number } | null) {
    this.arrow.visible = !!pos
    if (pos) this.arrow.userData.pos = new THREE.Vector3(toWorld(pos.x), pos.h ?? 1.2, toWorld(pos.y))
  }

  // ── ต่อเฟรม ───────────────────────────────────────────────────────────

  update(dt: number, now: number, players: PlayerView[], meUuid: string, mePos: { x: number; y: number }, target: Target | null, raining: boolean) {
    this.clock += dt
    this.syncPlots(now)
    this.syncSlots(now)
    this.syncGround()
    this.syncAnimals(now)
    this.syncPlayers(dt, now, players, meUuid, mePos)
    if (target) {
      const y = target.kind === 'plot' || target.kind === 'ground' ? 0.12 : 0.02
      this.ring.visible = true
      this.ring.position.set(toWorld(target.x), y, toWorld(target.y))
      this.ring.scale.setScalar(1 + Math.sin(this.clock * 6) * 0.06)
    } else this.ring.visible = false
    if (this.arrow.visible) {
      const p: THREE.Vector3 = this.arrow.userData.pos
      this.arrow.position.set(p.x, p.y + Math.abs(Math.sin(this.clock * 4)) * 0.25, p.z)
      this.arrow.rotation.y += dt * 2
    }
    this.animateAmbient(dt)
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]
      p.t += dt / 0.32
      p.obj.scale.setScalar(p.base * easeOutBack(Math.min(1, p.t)))
      if (p.t >= 1) this.pops.splice(i, 1)
    }
    this.fx.setRain(raining, new THREE.Vector3(toWorld(mePos.x), 0, toWorld(mePos.y)))
    this.fx.update(dt)
    this.r.follow(toWorld(mePos.x), toWorld(mePos.y))
  }

  private animateAmbient(dt: number) {
    const t = this.clock
    for (const a of this.ambient) {
      a.phase += dt * a.speed
      if (this.level.theme === 'snow') {
        a.obj.position.y -= dt * 0.6
        a.obj.position.x = a.home.x + Math.sin(a.phase * 2) * 0.3
        if (a.obj.position.y < 0) a.obj.position.y = 6
        continue
      }
      const x = a.home.x + Math.sin(a.phase) * 1.6 + Math.sin(a.phase * 2.3) * 0.4
      const z = a.home.z + Math.cos(a.phase * 0.8) * 1.3
      const nx = x - a.obj.position.x
      const nz = z - a.obj.position.z
      a.obj.position.set(x, a.home.y + Math.sin(a.phase * 3) * 0.15, z)
      a.obj.rotation.y = Math.atan2(nx, nz)
      const [wl, wr] = a.obj.userData.wings as THREE.Object3D[]
      const flap = Math.sin(t * 18 + a.phase) * 0.9
      wl.rotation.z = flap
      wr.rotation.z = -flap
      wl.rotation.x = wr.rotation.x = -Math.PI / 2
    }
    if (this.duck) {
      this.duck.position.set(this.duckHome.x + Math.sin(t * 0.4) * 0.25, Math.sin(t * 2) * 0.02, this.duckHome.z + Math.cos(t * 0.3) * 0.2)
      this.duck.rotation.y = t * 0.4 + Math.PI / 2
    }
  }

  private syncPlots(now: number) {
    for (const p of this.state.plots) {
      const rec = this.plots.get(p.id)
      if (!rec) continue
      const stage = liveStage(p, this.stateTime, now)
      const wet = p.moistUntil > now
      const pest = !!p.pestUntil
      const sig = `${p.soil}|${wet}|${p.crop}|${stage}`
      if (sig !== rec.sig) {
        const prevCrop = rec.sig.split('|')[2]
        const prevStage = rec.sig.split('|')[3]
        this.root.remove(rec.group)
        const g = new THREE.Group()
        const spot = this.level.plots.find((q) => q.id === p.id)!
        g.position.set(toWorld(spot.x), 0, toWorld(spot.y))
        g.add(M.soil(p.soil === 'raw' ? 'raw' : wet ? 'wet' : 'tilled'))
        if (p.crop && stage >= 0) {
          const c = use(`crop-${p.crop}-${stage}`, () => M.crop(p.crop!, stage))
          c.position.y = 0.06
          g.add(c)
          g.userData.cropObj = c
          // โตขึ้นระยะใหม่ / เพิ่งปลูก = เด้ง
          if (prevCrop !== p.crop || prevStage !== String(stage)) this.pop(c, 1)
        }
        if (stage === 3) {
          const glow = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.47, 24), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.9 }))
          glow.rotation.x = -Math.PI / 2
          glow.position.y = 0.1
          g.add(glow)
        }
        this.root.add(g)
        rec.group = g
        rec.sig = sig
      }
      // พร้อมเก็บ = เด้งเบาๆ ให้สังเกตง่าย
      const c: THREE.Object3D | undefined = rec.group.userData.cropObj
      if (c) c.position.y = 0.06 + (stage === 3 ? Math.abs(Math.sin(this.clock * 4)) * 0.06 : 0)
      const dry = p.crop && stage < 3 && !wet
      const html = pest ? '<span class="bug">🐛</span>' : dry ? '<span class="drop">💧</span>' : stage === 3 ? '<span class="spark">✨</span>' : ''
      if (rec.icon.element.innerHTML !== html) rec.icon.element.innerHTML = html
    }
  }

  private syncAnimals(now: number) {
    for (const a of this.state.animals || []) {
      const v = this.animals.get(a.id)
      if (!v) continue
      const spot = this.level.animals.find((q) => q.id === a.id)!
      const ready = a.fed && a.readyAt != null && now >= a.readyAt
      const product = this.catalog.animals[spot.type]?.product
      const emoji = this.catalog.allCrops[product]?.emoji ?? '⭐'
      const html = ready ? `<span class="spark">${emoji}</span>` : !a.fed ? '<span class="want">💭🌾</span>' : ''
      if (v.icon.element.innerHTML !== html) v.icon.element.innerHTML = html
      const sig = `${a.fed}|${ready}`
      if (sig !== v.sig) {
        v.rig.product.visible = ready
        if (ready) this.pop(v.rig.product, 1)
        v.sig = sig
      }
      v.bar.visible = a.fed && !ready
      if (v.bar.visible && a.readyAt) {
        const frac = 1 - (a.readyAt - now) / (a.total || 1)
        ;(v.bar.element.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`
      }
      // ท่าทาง: ไก่จิกพื้น/วัวเคี้ยว เร็วขึ้นตอนหิว, หางแกว่ง
      v.phase += 0.016
      const t = this.clock + v.phase
      if (spot.type === 'chicken') {
        const peck = Math.max(0, Math.sin(t * (a.fed ? 2 : 4))) ** 6
        v.rig.head.rotation.x = -0.25 + peck * 1.1 // เงยหน้าหากล้องนิดๆ ให้เห็นหน้า
        v.rig.root.position.y = Math.abs(Math.sin(t * 3)) * (a.fed ? 0 : 0.03)
      } else {
        v.rig.head.rotation.x = -0.15 + Math.sin(t * 1.5) * 0.08 + (a.fed ? 0.1 : 0)
        v.rig.head.rotation.z = Math.sin(t * 5) * 0.03
      }
      v.rig.tail.rotation.z = Math.sin(t * 3) * 0.4
      if (ready) v.rig.product.position.y = (spot.type === 'cow' ? 0.1 : 0.24) + Math.abs(Math.sin(this.clock * 4)) * 0.05
    }
  }

  private syncSlots(now: number) {
    const slots: { id: string; x: number; y: number; k: string | null; readyAt?: number | null; total?: number }[] = [
      ...this.state.counters.map((c) => ({ ...this.level.counters.find((q) => q.id === c.id)!, k: c.item?.k ?? null })),
      ...this.state.packers.map((c) => ({ ...this.level.packers.find((q) => q.id === c.id)!, k: c.item?.k ?? null, readyAt: c.readyAt, total: c.total })),
    ]
    for (const s of slots) {
      const cur = this.slotItems.get(s.id)
      // ของในจุดแพ็กที่ครบเวลาแล้วโชว์เป็นกล่องทันที ไม่ต้องรอ server ยืนยัน (server เปลี่ยนเองใน tick ถัดไป)
      const k = s.k && s.readyAt && now >= s.readyAt && s.k.startsWith('crop:') ? `box:${s.k.slice(5)}` : s.k
      if ((cur?.k ?? null) !== k) {
        if (cur) this.root.remove(cur.obj)
        if (k) {
          const obj = this.itemObj(k)
          this.at(s.x, s.y, obj, 0.6)
          this.root.add(obj)
          this.pop(obj)
          this.slotItems.set(s.id, { k, obj })
        } else this.slotItems.delete(s.id)
      }
      // แถบความคืบหน้าการแพ็ก
      let bar = this.packBars.get(s.id)
      const packing = s.readyAt && now < s.readyAt
      if (packing && !bar) {
        bar = label('<div class="fill"></div>', 'work-bar')
        bar.position.set(toWorld(s.x), 1.25, toWorld(s.y))
        this.root.add(bar)
        this.packBars.set(s.id, bar)
      }
      if (bar) {
        if (!packing) {
          this.root.remove(bar)
          bar.element.remove()
          this.packBars.delete(s.id)
        } else {
          const frac = 1 - (s.readyAt! - now) / (s.total || 1500)
          ;(bar.element.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`
        }
      }
    }
  }

  private syncGround() {
    const seen = new Set<string>()
    for (const g of this.state.ground) {
      seen.add(g.id)
      const cur = this.groundItems.get(g.id)
      if (!cur || cur.k !== g.item.k) {
        if (cur) this.root.remove(cur.obj)
        const obj = this.itemObj(g.item.k)
        this.at(g.x, g.y, obj, 0)
        const gadget = g.item.k === 'tool:sprinkler' || g.item.k === 'tool:scarecrow'
        obj.rotation.y = gadget ? 0 : (g.x * 7 + g.y * 13) % 6
        if (gadget) obj.scale.setScalar(1.35) // วางบนพื้นแล้วตัวใหญ่ขึ้น เห็นชัดว่าทำงานอยู่
        this.root.add(obj)
        this.pop(obj)
        this.groundItems.set(g.id, { k: g.item.k, obj })
      }
      if (g.item.k === 'tool:sprinkler') {
        this.groundItems.get(g.id)!.obj.traverse((o) => {
          if (o.userData.spin) o.rotation.y = this.clock * 5
        })
      }
    }
    for (const [id, cur] of this.groundItems) {
      if (!seen.has(id)) {
        this.root.remove(cur.obj)
        this.groundItems.delete(id)
      }
    }
  }

  private itemObj(k: string) {
    return use(`item-${k.replace(':', '-')}`, () => M.item(k))
  }

  private syncPlayers(dt: number, now: number, list: PlayerView[], meUuid: string, mePos: { x: number; y: number }) {
    const seen = new Set<string>()
    for (const p of list) {
      seen.add(p.uuid)
      let rig = this.players.get(p.uuid)
      if (!rig || rig.color !== p.color) {
        if (rig) this.removeRig(rig)
        rig = this.makeRig(p)
        this.players.set(p.uuid, rig)
      }
      const isMe = p.uuid === meUuid
      const src = isMe ? mePos : p
      rig.target.set(toWorld(src.x), 0, toWorld(src.y))
      const before = rig.pos.clone()
      // คนอื่นได้ตำแหน่งที่ interpolate มาแล้ว (net/remote.ts) — lerp ซ้ำอีกชั้นแค่ทำให้ช้ากว่าเดิม
      rig.pos.copy(rig.target)
      const moved = before.distanceTo(rig.pos) / Math.max(dt, 1e-3)
      rig.char.root.position.copy(rig.pos)

      // หันหน้าตามทิศที่หันล่าสุด (หมุนนุ่มๆ)
      const want = Math.atan2(p.fx, p.fy)
      let d = want - rig.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      rig.yaw += d * Math.min(1, dt * 14)
      rig.char.root.rotation.y = rig.yaw

      // เดิน: แกว่งขา/แขน + ตัวเด้งแบบยืดหด (squash & stretch) · ยืนเฉยๆ = หายใจ
      const walking = moved > 0.4
      rig.walkT += dt * (walking ? 13 : 0)
      const swing = walking ? Math.sin(rig.walkT) * 0.7 : 0
      rig.char.legL.rotation.x = swing
      rig.char.legR.rotation.x = -swing
      const hop = walking ? Math.abs(Math.sin(rig.walkT)) : 0
      rig.char.body.position.y = hop * 0.07
      const breathe = walking ? 0 : Math.sin(this.clock * 2.5 + rig.color) * 0.015
      rig.char.body.scale.set(1 - hop * 0.04 - breathe, 1 + hop * 0.06 + breathe, 1 - hop * 0.04 - breathe)
      rig.char.head.rotation.z = walking ? Math.sin(rig.walkT) * 0.06 : Math.sin(this.clock * 0.8 + rig.color) * 0.05
      const working = p.work && p.work.until > now
      const holding = !!p.held
      const armX = working ? -1.2 + Math.sin(this.clock * 18) * 0.5 : holding ? -1.25 : -swing * 0.8
      rig.char.armL.rotation.x = holding || working ? armX : -swing * 0.8
      rig.char.armR.rotation.x = holding || working ? armX : swing * 0.8

      // กระพริบตา
      if (this.clock > rig.blinkAt) rig.blinkAt = this.clock + 2 + Math.random() * 3
      const blink = rig.blinkAt - this.clock < 0.12 ? 0.15 : 1
      for (const e of rig.char.eyes) e.scale.y = blink

      // ของในมือ
      const k = p.held?.k ?? null
      if (k !== rig.heldK) {
        if (rig.heldObj) rig.char.hand.remove(rig.heldObj)
        rig.heldObj = k ? this.itemObj(k) : null
        if (rig.heldObj) {
          rig.char.hand.add(rig.heldObj)
          this.pop(rig.heldObj, 0.9)
        }
        rig.heldK = k
      }

      // แถบความคืบหน้างาน (ไถ/รด/เกี่ยว)
      const barEl = rig.bar.element
      rig.bar.visible = !!working
      if (working) {
        const frac = 1 - (p.work!.until - now) / p.work!.total
        ;(barEl.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`
      }
      if (walking && Math.random() < dt * 6) this.fx.burst(rig.pos.x, rig.pos.z, this.level.theme === 'snow' ? '#ffffff' : '#e8d4b0', 1, 0.4, 0.05)
    }
    for (const [uuid, rig] of this.players) {
      if (!seen.has(uuid)) {
        this.removeRig(rig)
        this.players.delete(uuid)
      }
    }
  }

  private makeRig(p: PlayerView): PlayerRig {
    const char = M.character(p.color)
    const lbl = label(p.name, 'name-tag')
    lbl.position.set(0, 1.5, 0)
    char.root.add(lbl)
    const bar = label('<div class="fill"></div>', 'work-bar')
    bar.position.set(0, 1.8, 0)
    bar.visible = false // ห้ามใช้ style.display — CSS2DRenderer เขียนทับตาม .visible ทุกเฟรม
    char.root.add(bar)
    this.root.add(char.root)
    this.pop(char.root, 1)
    const pos = new THREE.Vector3(toWorld(p.x), 0, toWorld(p.y))
    return { char, label: lbl, bar, heldK: null, heldObj: null, pos, target: pos.clone(), yaw: Math.atan2(p.fx, p.fy), walkT: 0, color: p.color, blinkAt: 1 + Math.random() * 3 }
  }

  private removeRig(rig: PlayerRig) {
    this.root.remove(rig.char.root)
    rig.label.element.remove()
    rig.bar.element.remove()
  }

  dispose() {
    for (const rig of this.players.values()) this.removeRig(rig)
    this.players.clear()
    this.root.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove()
    })
    this.r.scene.remove(this.root)
    this.root = new THREE.Group()
    this.plots.clear()
    this.slotItems.clear()
    this.packBars.clear()
    this.groundItems.clear()
    this.animals.clear()
    this.pops = []
    this.ambient = []
    this.duck = null
    this.fx.clear()
  }
}
