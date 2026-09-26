import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { item as makeItem, mat } from './models'

interface Particle {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  max: number
}
interface Arc {
  obj: THREE.Object3D
  from: THREE.Vector3
  to: THREE.Vector3
  t: number
  drop?: boolean // ตกตรงลงมา (พัสดุจากฟ้า) แทนโค้งแบบโยน
}
interface Floater {
  obj: CSS2DObject
  t: number
}

export type ParticleShape = 'ball' | 'star' | 'heart' | 'leaf'

function heartGeo() {
  const s = new THREE.Shape()
  s.moveTo(0, -0.06)
  s.bezierCurveTo(-0.1, 0.0, -0.06, 0.08, 0, 0.035)
  s.bezierCurveTo(0.06, 0.08, 0.1, 0.0, 0, -0.06)
  return new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false }).center()
}
function starGeo() {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.03 : 0.07
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }).center()
}
const basicCache = new Map<string, THREE.MeshBasicMaterial>()
const basic = (color: string) => {
  let m = basicCache.get(color)
  if (!m) basicCache.set(color, (m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })))
  return m
}
const GEO: Record<ParticleShape, THREE.BufferGeometry> = {
  ball: new THREE.IcosahedronGeometry(0.05, 1),
  star: starGeo(),
  heart: heartGeo(),
  leaf: new THREE.SphereGeometry(0.05, 8, 4).scale(1, 0.3, 0.6),
}

/** เอฟเฟกต์ทั้งหมดที่เกิดชั่วคราว — เรียก update(dt) ทุกเฟรม */
export class Fx {
  private particles: Particle[] = []
  private arcs: Arc[] = []
  private floaters: Floater[] = []
  private rain: THREE.LineSegments | null = null
  private rainVel: Float32Array | null = null

  constructor(private scene: THREE.Scene) {}

  burst(x: number, z: number, color: string, n = 10, speed = 1.6, y = 0.3, shape: ParticleShape = 'ball') {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(GEO[shape], shape === 'ball' ? mat(color) : basic(color))
      m.position.set(x, y, z)
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0)
      m.userData.spin = shape !== 'ball'
      const a = Math.random() * Math.PI * 2
      const vel = new THREE.Vector3(Math.cos(a) * speed * Math.random(), 1.5 + Math.random() * speed, Math.sin(a) * speed * Math.random())
      this.scene.add(m)
      this.particles.push({ mesh: m, vel, life: 0, max: 0.6 + Math.random() * 0.4 })
    }
  }

  /** ของที่ถูกโยน ลอยเป็นเส้นโค้งจาก from ไป to ใน 0.4 วิ (ตัวจริงบนพื้น/โต๊ะมาจาก level:state) */
  throwArc(k: string, from: THREE.Vector3, to: THREE.Vector3) {
    const obj = makeItem(k)
    this.scene.add(obj)
    this.arcs.push({ obj, from, to, t: 0 })
  }

  /** พัสดุตกจากฟ้าลงตรงจุด (0.6 วิ) — ของจริงบนพื้นมาจาก level:state */
  drop(k: string, from: THREE.Vector3, to: THREE.Vector3) {
    const obj = makeItem(k)
    this.scene.add(obj)
    this.arcs.push({ obj, from, to, t: 0, drop: true })
  }

  floatText(text: string, pos: THREE.Vector3, color = '#ffd84a') {
    const el = document.createElement('div')
    el.textContent = text
    el.style.cssText = `font:700 24px var(--font);color:${color};text-shadow:0 2px 0 #7a4a00,0 0 8px rgba(0,0,0,.35);white-space:nowrap`
    const obj = new CSS2DObject(el)
    obj.position.copy(pos)
    this.scene.add(obj)
    this.floaters.push({ obj, t: 0 })
  }

  setRain(on: boolean, center: THREE.Vector3) {
    if (on && !this.rain) {
      const n = 500
      const pos = new Float32Array(n * 6)
      this.rainVel = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const x = center.x + (Math.random() - 0.5) * 24
        const y = Math.random() * 10
        const z = center.z + (Math.random() - 0.5) * 18
        pos.set([x, y, z, x - 0.05, y - 0.35, z], i * 6)
        this.rainVel[i] = 12 + Math.random() * 5
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.55 }))
      this.scene.add(this.rain)
    } else if (!on && this.rain) {
      this.scene.remove(this.rain)
      this.rain.geometry.dispose()
      this.rain = null
    }
    if (this.rain) {
      this.rain.userData.center = center.clone()
    }
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt
      p.vel.y -= 6 * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      p.mesh.scale.setScalar(Math.max(0.01, 1 - p.life / p.max))
      if (p.mesh.userData.spin) p.mesh.rotation.y += dt * 6
      if (p.life >= p.max || p.mesh.position.y < 0) {
        this.scene.remove(p.mesh)
        this.particles.splice(i, 1)
      }
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i]
      a.t += dt / (a.drop ? 0.6 : 0.4)
      const t = Math.min(1, a.t)
      a.obj.position.lerpVectors(a.from, a.to, a.drop ? t * t : t)
      if (a.drop) a.obj.rotation.y += dt * 8
      else {
        a.obj.position.y = a.from.y + (a.to.y - a.from.y) * t + Math.sin(t * Math.PI) * 1.2
        a.obj.rotation.x += dt * 10
      }
      if (t >= 1) {
        this.scene.remove(a.obj)
        this.arcs.splice(i, 1)
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]
      f.t += dt
      f.obj.position.y += dt * 1.2
      f.obj.element.style.opacity = String(Math.max(0, 1 - f.t / 1.4))
      if (f.t >= 1.4) {
        this.scene.remove(f.obj)
        f.obj.element.remove()
        this.floaters.splice(i, 1)
      }
    }
    if (this.rain && this.rainVel) {
      const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute
      const c: THREE.Vector3 = this.rain.userData.center
      for (let i = 0; i < this.rainVel.length; i++) {
        let y = pos.getY(i * 2) - this.rainVel[i] * dt
        let x = pos.getX(i * 2)
        let z = pos.getZ(i * 2)
        if (y < 0) {
          y = 9 + Math.random()
          x = c.x + (Math.random() - 0.5) * 24
          z = c.z + (Math.random() - 0.5) * 18
        }
        pos.setXYZ(i * 2, x, y, z)
        pos.setXYZ(i * 2 + 1, x - 0.05, y - 0.35, z)
      }
      pos.needsUpdate = true
    }
  }

  clear() {
    for (const p of this.particles) this.scene.remove(p.mesh)
    for (const a of this.arcs) this.scene.remove(a.obj)
    for (const f of this.floaters) {
      this.scene.remove(f.obj)
      f.obj.element.remove()
    }
    this.particles = []
    this.arcs = []
    this.floaters = []
    this.setRain(false, new THREE.Vector3())
  }
}
