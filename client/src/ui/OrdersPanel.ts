import type { Catalog, OrderView } from '../types'
import { now } from '../net/clock'

/** การ์ดออเดอร์ของทีม มุมซ้ายบน — ของที่ต้องส่ง (ส่งแล้ว/ทั้งหมด), รางวัล, แถบนับถอยหลัง, ⚡ = ออเดอร์ด่วน */
export class OrdersPanel {
  private root: HTMLDivElement
  private orders: OrderView[] = []
  private catalog: Catalog | null = null

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    this.root.id = 'orders-panel'
    container.appendChild(this.root)

    const style = document.createElement('style')
    style.textContent = `
      /* การ์ดบรรทัดเดียว — มือถือเป็นหลัก การ์ดสูงๆ ซ้อนกัน 4 ใบบังฉากครึ่งจอ */
      #orders-panel { position: fixed; left: 6px; top: 50px; display: flex; flex-direction: column; gap: 4px; z-index: 500;
        max-width: min(44vw, 230px); pointer-events: none; }
      .order { background: rgba(255,255,255,.9); color: #2b2b2b; border-radius: 9px; padding: 3px 7px 4px; font-size: 12px;
        box-shadow: 0 2px 6px rgba(0,0,0,.22); border: 1.5px solid transparent; }
      .order.rush { border-color: #ff9f1a; background: #fff6e6; }
      .order .top { display: flex; align-items: center; gap: 6px; }
      .order .items { flex: 1; font-weight: 800; display: flex; flex-wrap: wrap; gap: 2px 6px; }
      .order .items .done { opacity: .35; }
      .order .bx { font-size: 9px; margin-right: -2px; vertical-align: top; }
      .order .rw { font-size: 10px; font-weight: 700; color: #9a7000; white-space: nowrap; }
      .order .left { font-size: 10px; font-weight: 700; color: #666; min-width: 26px; text-align: right; white-space: nowrap; }
      .order.hurry .left { color: #e03030; }
      .order .bar { height: 3px; border-radius: 2px; background: #e5e5e5; margin-top: 3px; overflow: hidden; }
      .order .bar > div { height: 100%; background: #5cc03b; }
      .order.hurry .bar > div { background: #ff4d4d; }
      #orders-empty { color: #fff; font-size: 11px; background: rgba(0,0,0,.45); padding: 3px 8px; border-radius: 8px; }
      /* มือถือแนวนอนจอกว้างพอ: ป้ายเวลาอยู่กลาง ออเดอร์ขึ้นไปชิดบนได้ ประหยัดความสูง */
      @media (orientation: landscape) and (max-height: 520px) and (min-width: 760px) { #orders-panel { top: 8px; } }
      /* แนวตั้งแคบ: แถบรอบชิดซ้ายบน (Hud.ts) — การ์ดต่อใต้แถบเลย */
      @media (orientation: portrait) and (max-width: 520px) { #orders-panel { top: 38px; } }
    `
    document.head.appendChild(style)
    setInterval(() => this.tick(), 250)
  }

  setCatalog(c: Catalog) {
    this.catalog = c
  }

  set(orders: OrderView[]) {
    this.orders = orders || []
    this.render()
  }

  // รายการในออเดอร์เป็น item.k เช่น 'box:carrot' — โชว์ emoji ของพืชพร้อมกล่อง
  private emoji(k: string) {
    const id = k.split(':')[1] ?? k
    const e = this.catalog?.crops[id]?.emoji || this.catalog?.allCrops[id]?.emoji || id
    return k.startsWith('box:') ? `<span class="bx">📦</span>${e}` : e
  }

  private render() {
    if (!this.orders.length) {
      this.root.innerHTML = '<div id="orders-empty">📋 รอออเดอร์…</div>'
      return
    }
    this.root.innerHTML = this.orders
      .map((o) => {
        const items = Object.entries(o.items)
          .map(([cid, it]) => `<span class="${it.have >= it.need ? 'done' : ''}">${this.emoji(cid)} ${it.have}/${it.need}</span>`)
          .join('')
        return `<div class="order ${o.rush ? 'rush' : ''}" data-id="${o.id}"><div class="top">
          <div class="items">${o.rush ? '⚡' : ''}${items}</div><span class="rw">🪙${o.reward}</span><span class="left"></span></div>
          <div class="bar"><div></div></div></div>`
      })
      .join('')
    this.tick()
  }

  private tick() {
    const t = now()
    for (const o of this.orders) {
      const el = this.root.querySelector<HTMLDivElement>(`.order[data-id="${o.id}"]`)
      if (!el) continue
      const leftSec = Math.max(0, (o.expiresAt - t) / 1000)
      el.querySelector<HTMLSpanElement>('.left')!.textContent = `${Math.ceil(leftSec)}วิ`
      el.querySelector<HTMLDivElement>('.bar > div')!.style.width = `${Math.min(1, leftSec / o.totalSec) * 100}%`
      el.classList.toggle('hurry', leftSec <= 10)
    }
  }
}
