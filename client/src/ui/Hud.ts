import type { Socket } from 'socket.io-client'
import type { Catalog, ItemView, RoundEnd, RoundView, TeamView } from '../types'
import { now } from '../net/clock'
import { setMusic, setSfx, settings } from '../audio/engine'

export interface Btn {
  icon: string
  label: string
  enabled: boolean
  run?: () => void
}
export interface ActionSet {
  primary: Btn
  use: Btn | null // null = ซ่อน (ไม่ได้ถือเครื่องมือ)
  throw: Btn | null
}

const EVENT_TEXT: Record<string, string> = {
  rain: '🌧️ ฝนตก — เดินช้าลง',
  pests: '🐛 แมลงบุก! รีบไล่',
  rush: '⚡ ออเดอร์ด่วน',
  bees: '🐝 ผึ้งมาช่วย พืชโตพรวด!',
  gift: '🎁 พัสดุตกจากฟ้า!',
  market: '🛒 ตลาดนัด ขายได้ราคา ×2',
}
const HINT_KEY = 'farm.hints'

/** emoji + ชื่อสั้นของไอเท็ม (ใช้ทั้งปุ่ม, ป้ายของในมือ, ออเดอร์) */
export function itemLabel(k: string, catalog: Catalog): { emoji: string; name: string } {
  const [kind, id] = k.split(':')
  const crop = catalog.allCrops[id]
  if (kind === 'seed') return { emoji: '🌱', name: `เมล็ด${crop?.name ?? ''}` }
  if (kind === 'feed') return { emoji: '🌾', name: 'อาหารสัตว์' }
  if (kind === 'crop') return { emoji: crop?.emoji ?? '?', name: crop?.name ?? id }
  if (kind === 'box') return { emoji: `📦${crop?.emoji ?? ''}`, name: `กล่อง${crop?.name ?? ''}` }
  if (kind === 'tool') return { emoji: catalog.tools[id]?.emoji ?? '🛠️', name: catalog.tools[id]?.name ?? id }
  return { emoji: '❔', name: k }
}

/**
 * HUD (DOM ทับ canvas 3D) — แถบรอบ (เวลา/คะแนน/ดาว/เหตุการณ์) บนกลาง, เงินทีม + ของในมือ ขวาบน,
 * ปุ่มกลมใหญ่ 3 ปุ่ม ขวาล่าง (นิ้วโป้งขวา — จอยอยู่ซ้ายล่าง), toast, sheet เลือกเมล็ด/ร้านค้า, การ์ดสรุปผล
 */
export class Hud {
  team!: TeamView
  round!: RoundView
  private catalog!: Catalog
  private topbar: HTMLDivElement
  private stats: HTMLDivElement
  private coinsEl: HTMLDivElement
  private heldEl: HTMLDivElement
  private actions: HTMLDivElement
  private toastEl: HTMLDivElement
  private modal: HTMLDivElement
  private actionKey = ''
  private toastTimer = 0
  private modalRender: (() => void) | null = null
  private heldKey = ''
  private tipEl: HTMLDivElement
  hintsOn = true

  constructor(container: HTMLElement, private socket: Socket) {
    this.topbar = this.el(container, 'hud-top')
    this.stats = this.el(container, 'hud-stats')
    // ⚙️ (มือถือเท่านั้น) พับปุ่ม 🎵🔊💡 ไว้ในถาดเล็กๆ ไม่ให้ปุ่มกลมสามปุ่มลอยทับฉากตลอดเวลา
    const menuBtn = document.createElement('button')
    menuBtn.id = 'hud-menu-btn'
    menuBtn.type = 'button'
    menuBtn.textContent = '⚙️'
    menuBtn.title = 'เสียง / ตัวช่วย'
    this.coinsEl = document.createElement('div')
    this.coinsEl.className = 'coins'
    this.heldEl = document.createElement('div')
    this.heldEl.className = 'held'
    this.stats.append(menuBtn, this.coinsEl, this.heldEl)
    const tray = this.el(container, 'hud-tray')
    let trayTimer = 0
    const armTray = () => {
      clearTimeout(trayTimer)
      trayTimer = window.setTimeout(() => tray.classList.remove('open'), 5000)
    }
    menuBtn.addEventListener('click', () => {
      // ถาดห้อยลงใต้ปุ่ม ⚙️ พอดี (ความกว้างป้ายเงินเปลี่ยนตามจำนวนหลัก เลยวัดตอนเปิด)
      const r = menuBtn.getBoundingClientRect()
      tray.style.setProperty('--tray-right', `${window.innerWidth - r.right}px`)
      tray.style.setProperty('--tray-top', `${r.bottom + 6}px`)
      tray.classList.toggle('open')
      armTray()
    })
    tray.addEventListener('click', armTray)
    this.actions = this.el(container, 'hud-actions')
    this.toastEl = this.el(container, 'hud-toast')
    this.modal = this.el(container, 'hud-modal')
    this.tipEl = this.el(container, 'hud-tip')
    try {
      this.hintsOn = localStorage.getItem(HINT_KEY) !== '0'
    } catch {
      /* โหมดส่วนตัว/บล็อก storage — เปิดตัวช่วยไว้ตามค่าเริ่มต้น */
    }
    const hintBtn = document.createElement('div')
    hintBtn.id = 'hud-hint-btn'
    tray.appendChild(hintBtn)
    const paintHint = () => {
      hintBtn.textContent = this.hintsOn ? '💡' : '💤'
      hintBtn.title = this.hintsOn ? 'ปิดตัวช่วยนำทาง' : 'เปิดตัวช่วยนำทาง'
      hintBtn.classList.toggle('off', !this.hintsOn)
    }
    paintHint()
    hintBtn.addEventListener('click', () => {
      this.hintsOn = !this.hintsOn
      try {
        localStorage.setItem(HINT_KEY, this.hintsOn ? '1' : '0')
      } catch {
        /* ไม่ต้องจำก็ได้ */
      }
      paintHint()
      if (!this.hintsOn) this.setTip('')
    })
    // ปุ่มเปิด/ปิดเพลง 🎵 และเสียงเอฟเฟกต์ 🔊 (จำใน localStorage — audio/engine.ts)
    const toggle = (icon: string, what: string, get: () => boolean, set: (on: boolean) => void) => {
      const b = document.createElement('div')
      b.className = 'hud-sound-btn'
      const paint = () => {
        b.textContent = icon
        b.title = `${get() ? 'ปิด' : 'เปิด'}${what}`
        b.classList.toggle('off', !get())
      }
      paint()
      b.addEventListener('click', () => {
        set(!get())
        paint()
      })
      tray.appendChild(b)
    }
    toggle('🎵', 'เพลง', () => settings.music, setMusic)
    toggle('🔊', 'เสียงเอฟเฟกต์', () => settings.sfx, setSfx)
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal && this.modalRender) this.closeModal()
    })
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    setInterval(() => this.tick(), 250)
  }

  private el(container: HTMLElement, id: string) {
    const d = document.createElement('div')
    d.id = id
    container.appendChild(d)
    return d
  }

  setCatalog(c: Catalog) {
    this.catalog = c
  }

  setTeam(team: TeamView) {
    this.team = team
    this.renderStats(null, true)
    this.modalRender?.()
  }

  setRound(r: RoundView) {
    this.round = r
    this.tick()
  }

  /** ป้ายของในมือ + เงินทีม — เขียน DOM เฉพาะตอนเปลี่ยน */
  renderStats(held: ItemView | null, force = false) {
    if (!this.team || !this.catalog) return
    const key = `${this.team.coins}|${held?.k}|${held?.water}|${held?.n}|${this.team.canCap}`
    if (!force && key === this.heldKey) return
    this.heldKey = key
    // มือถือ: ซ่อนชื่อ (.nm) เหลือแค่ไอคอน + น้ำ/จำนวนครั้ง ในช่องว่างมุมกลุ่มปุ่มกด — มือว่างไม่ต้องโชว์
    let heldHtml = '<span class="empty">มือว่าง</span>'
    if (held) {
      const l = itemLabel(held.k, this.catalog)
      const water = held.k === 'tool:can' ? ` <b class="water">💧${held.water ?? 0}/${this.team.canCap}</b>` : ''
      const n = held.n && held.n > 1 ? ` <b class="n">×${held.n}</b>` : ''
      heldHtml = `<span class="ico">${l.emoji}</span><span class="nm">${l.name}</span>${water}${n}`
    }
    this.coinsEl.innerHTML = `🪙 <b>${this.team.coins}</b>`
    this.heldEl.innerHTML = heldHtml
    this.heldEl.classList.toggle('none', !held)
  }

  /** บรรทัดตัวช่วยนำทาง (จาก input/hint.ts) — เขียน DOM เฉพาะตอนข้อความเปลี่ยน */
  setTip(text: string) {
    if (this.tipEl.textContent === text) return
    this.tipEl.textContent = text
    this.tipEl.classList.toggle('show', !!text)
  }

  private tick() {
    const r = this.round
    if (!r) return
    const left = Math.max(0, Math.ceil((r.endsAt - now()) / 1000))
    const mm = Math.floor(left / 60)
    const ss = String(left % 60).padStart(2, '0')
    const got = r.stars.filter((x) => r.score >= x).length
    const next = r.stars.find((x) => r.score < x)
    const stars = r.stars.map((_, i) => `<span class="${i < got ? 'on' : ''}">★</span>`).join('')
    const ev = r.event && r.event.until > now() ? `<div class="ev ${r.event.type}">${EVENT_TEXT[r.event.type] ?? ''}</div>` : ''
    // จอแนวตั้งแคบ: ป้ายเหตุการณ์ใต้แถบจะทับการ์ดออเดอร์ — โชว์แค่ emoji ในแถบแทน (CSS สลับ .ev / .evi)
    const evIcon = ev ? `<span class="evi ${r.event!.type}">${[...(EVENT_TEXT[r.event!.type] ?? '')][0] ?? ''}</span>` : ''
    const assist = (r.assist || []).map((id) => this.team?.shop.find((s) => s.id === id)?.emoji ?? '').join('')
    this.topbar.innerHTML =
      r.phase === 'playing'
        ? `<div class="pill"><span class="time ${left <= 20 ? 'low' : ''}">⏱ ${mm}:${ss}</span>
           <span class="score">${r.score}</span><span class="stars">${stars}</span>
           ${next ? `<small class="next"><span class="w">ต่อไป </span>${next}</small>` : ''}<small class="ppl" title="ความยากปรับตามจำนวนคน">👥${r.players ?? 1}</small>${assist ? `<small class="assist" title="ตัวช่วยฟรีสำหรับทีมเล็ก">🤝<span class="ic">${assist}</span></small>` : ''}${evIcon}</div>${ev}`
        : `<div class="pill">${r.mapName}</div>`
  }

  /** ปุ่มกลม 3 ปุ่ม — เขียน DOM ใหม่เฉพาะตอนเนื้อหาเปลี่ยน (เขียนทุกเฟรม = การแตะที่กำลังกดอยู่หลุด) */
  setActions(set: ActionSet) {
    const key = [set.primary, set.use, set.throw].map((b) => (b ? `${b.icon}${b.label}${b.enabled}` : '-')).join('|')
    if (key === this.actionKey) {
      // ข้อความเดิมแต่ handler อาจชี้เป้าหมายใหม่ — ผูกใหม่โดยไม่แตะ DOM
      this.bind(set)
      return
    }
    this.actionKey = key
    const btn = (id: string, b: Btn | null, cls: string) =>
      b ? `<button id="${id}" class="act ${cls}" ${b.enabled ? '' : 'disabled'}><span class="i">${b.icon}</span><span class="l">${b.label}</span></button>` : ''
    this.actions.innerHTML = `${btn('act-throw', set.throw, 'small')}${btn('act-use', set.use, 'mid')}${btn('act-primary', set.primary, 'big')}`
    this.bind(set)
  }

  private bind(set: ActionSet) {
    const on = (id: string, b: Btn | null) => {
      const el = this.actions.querySelector<HTMLButtonElement>(`#${id}`)
      if (el) el.onclick = b?.enabled && b.run ? b.run : null
    }
    on('act-primary', set.primary)
    on('act-use', set.use)
    on('act-throw', set.throw)
  }

  toast(text: string) {
    this.toastEl.textContent = text
    this.toastEl.classList.add('show')
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600)
  }

  get modalOpen() {
    return this.modal.classList.contains('open')
  }

  closeModal() {
    this.modal.classList.remove('open', 'center')
    this.modalRender = null
    this.modal.innerHTML = ''
  }

  private openModal(render: () => string, bind: (root: HTMLElement) => void) {
    this.modalRender = () => {
      this.modal.innerHTML = `<div class="sheet">${render()}</div>`
      this.modal.querySelector('.close')?.addEventListener('click', () => this.closeModal())
      bind(this.modal)
    }
    this.modalRender()
    this.modal.classList.remove('center')
    this.modal.classList.add('open')
  }

  /** กล่องเมล็ด — เลือกแล้วได้ถุงเมล็ดในมือ 1 ถุง (เงินทีม) */
  openSeeds() {
    this.openModal(
      () => {
        const rows = this.catalog.cropOrder
          .map((cid) => {
            const c = this.catalog.crops[cid]
            const ok = this.team.coins >= c.seed
            return `<div class="row"><div class="icon">${c.emoji}</div>
              <div class="txt"><b>${c.name}</b><small>ต้องชื้น ${Math.round(c.growMs / 1000)} วิ · ส่งออก ${c.order}/กล่อง</small></div>
              <button data-crop="${cid}" ${ok ? '' : 'disabled'}>${c.seed ? `🪙 ${c.seed}` : 'ฟรี'}</button></div>`
          })
          .join('')
        const bag = this.team.upgrades?.includes('seed_bag') ? ' · 🎒 ถุงใหญ่: หยิบครั้งเดียวใช้ได้ 3 ครั้ง' : ''
        const animals = this.catalog.products?.length
          ? `<div class="row feed"><div class="icon">🌾</div>
              <div class="txt"><b>อาหารสัตว์</b><small>ให้${this.catalog.products.map((p) => `${this.catalog.allCrops[p]?.emoji}`).join('')} ${Object.values(this.catalog.animals).filter((a) => this.catalog.products.includes(a.product)).map((a) => a.name).join('/')}กิน แล้วรอเก็บของ</small></div>
              <button data-crop="feed">ฟรี</button></div>`
          : ''
        return `<h3>🌱 หยิบเมล็ด <button class="close">✕</button></h3>
          <div class="sub">ไถดินด้วยจอบก่อน แล้วถือเมล็ดไปกด "ปลูก" ที่แปลง — พืชโตเฉพาะตอนดินชื้น (รดน้ำ)${bag}</div>${rows}${animals}`
      },
      (root) =>
        root.querySelectorAll<HTMLButtonElement>('button[data-crop]').forEach((b) =>
          b.addEventListener('click', () => {
            this.socket.emit('act:seed', { crop: b.dataset.crop })
            this.closeModal()
          }),
        ),
    )
  }

  openShop() {
    this.openModal(
      () => {
        const items = this.team.shop
          .map((i) => {
            const ok = i.price != null && this.team.coins >= i.price
            return `<div class="row"><div class="icon">${i.emoji}</div>
              <div class="txt"><b>${i.name}</b><small>${i.desc}</small></div>
              <button data-buy="${i.id}" ${ok ? '' : 'disabled'} class="${i.free ? 'free' : ''}">${i.free ? 'ฟรี 🤝' : i.price == null ? 'ครบแล้ว' : `🪙 ${i.price}`}</button></div>`
          })
          .join('')
        return `<h3>🏪 ร้านค้า <button class="close">✕</button></h3>
          <div class="sub">เงินทีม ${this.team.coins} 🪙 — ซื้อแล้วใช้ได้ถึงจบรอบ · อยากขายของ: ถือผลผลิตมากด "ขาย" ที่ร้าน${this.team.sellMul > 1 ? ` <b class="hot">🛒 ตลาดนัด ราคา ×${this.team.sellMul}!</b>` : ''}</div>${items}`
      },
      (root) =>
        root.querySelectorAll<HTMLButtonElement>('button[data-buy]').forEach((b) =>
          b.addEventListener('click', () => this.socket.emit('act:buy', { id: b.dataset.buy })),
        ),
    )
  }

  showResults(r: RoundEnd) {
    this.modalRender = null
    const stars = r.thresholds.map((_, i) => `<span class="${i < r.stars ? 'on' : ''}">★</span>`).join('')
    const draw = () => {
      if (!this.modal.classList.contains('open')) return
      const left = Math.max(0, Math.ceil((r.nextAt - now()) / 1000))
      this.modal.innerHTML = `<div class="results">
        <div class="ribbon">จบรอบ!</div>
        <h2>${r.mapName}</h2>
        <div class="bigstars">${stars}</div>
        <div class="score">${r.score}</div>
        <div class="line">ดาว: ${r.thresholds.join(' / ')} คะแนน <small>(ปรับตามผู้เล่น ${r.players ?? 1} คน)</small></div>
        <div class="line">✅ ส่งสำเร็จ ${r.completed} · ❌ หมดเวลา ${r.failed}</div>
        <div class="line best">${r.newBest ? '🎉 ทำลายสถิติ!' : `สถิติสูงสุด ${r.best}`}</div>
        <div class="next">รอบต่อไป: ${r.nextMapName} ใน ${left} วิ</div></div>`
      if (left > 0) window.setTimeout(draw, 500)
    }
    this.modal.classList.add('open', 'center')
    draw()
  }
}

const CSS = `
  #hud-top { position: fixed; left: 50%; top: 8px; transform: translateX(-50%); z-index: 600; display: flex; flex-direction: column;
    align-items: center; gap: 4px; pointer-events: none; }
  #hud-top .pill { display: flex; align-items: center; gap: 10px; background: linear-gradient(180deg,#fffaf0,#ffeccc);
    color: #6b4220; padding: 5px 16px; border-radius: 24px; font-weight: 700; font-size: 16px; white-space: nowrap;
    border: 3px solid #fff; box-shadow: 0 4px 0 #e0b27a, 0 6px 16px rgba(120,70,20,.25); }
  #hud-top .time { color: #4a86c8; }
  #hud-top .time.low { color: #ff5a5a; animation: pulse .6s infinite; }
  #hud-top .score { color: #ff8a3c; font-size: 19px; }
  #hud-top .stars span { color: #ecd9bd; font-size: 16px; }
  #hud-top .stars span.on { color: #ffc61a; text-shadow: 0 2px 0 #d99400; }
  #hud-top small { font-weight: 600; opacity: .8; font-size: 11px; }
  #hud-top .assist { background: #e3f7d9; color: #3d7a2a; border-radius: 10px; padding: 1px 6px; opacity: 1; }
  #hud-top .ev { background: #ffb347; color: #4a2600; padding: 3px 12px; border-radius: 14px; font-size: 12px; font-weight: 700;
    box-shadow: 0 3px 0 #d98a1a; animation: pulse 1s infinite; border: 2px solid #fff; }
  #hud-top .ev.bees, #hud-top .ev.gift, #hud-top .ev.market { background: #9be38a; box-shadow: 0 3px 0 #5fae4f; color: #1f4a14; }
  #hud-top .ev.rain { background: #8fd3ff; box-shadow: 0 3px 0 #4f9fd1; color: #0d3a57; }
  @keyframes pulse { 50% { transform: scale(1.06); } }
  #hud-stats { position: fixed; right: 8px; top: 8px; z-index: 500; display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
    pointer-events: none; }
  #hud-stats .coins { background: linear-gradient(180deg,#fff7df,#ffe29a); color: #7a4a00; font-weight: 700; font-size: 17px;
    padding: 3px 14px; border-radius: 18px; border: 3px solid #fff; box-shadow: 0 3px 0 #e0a83a, 0 4px 10px rgba(120,70,20,.2); }
  #hud-stats .held { background: rgba(255,252,245,.95); color: #5a3a20; font-size: 13px; font-weight: 600; padding: 4px 10px;
    border-radius: 14px; box-shadow: 0 3px 10px rgba(120,70,20,.2); max-width: 46vw; border: 2px solid #fff; }
  #hud-stats .n { color: #e07a1a; }
  #hud-tip { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%) translateY(8px); z-index: 520; pointer-events: none;
    background: rgba(255,252,245,.94); color: #6b4220; font-size: 13px; font-weight: 600; padding: 5px 14px; border-radius: 16px;
    border: 2px solid #ffd23f; box-shadow: 0 3px 0 #e0b27a; opacity: 0; transition: opacity .25s, transform .25s; max-width: 54vw;
    text-align: center; width: max-content; box-sizing: border-box; }
  #hud-tip.show { opacity: 1; transform: translateX(-50%); }
  /* 🎵🔊💡 — เดสก์ท็อปเรียงแถวใต้เงินตลอด, มือถือพับอยู่ใต้ปุ่ม ⚙️ */
  #hud-tray { position: fixed; right: 8px; top: 86px; z-index: 520; display: flex; flex-direction: row-reverse; gap: 6px; }
  #hud-hint-btn, .hud-sound-btn, #hud-menu-btn { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; font-size: 16px; background: #fffaf0; border: 2px solid #fff; cursor: pointer; box-shadow: 0 3px 0 #e0b27a;
    user-select: none; padding: 0; box-sizing: border-box; pointer-events: auto; }
  #hud-menu-btn { display: none; }
  #hud-hint-btn.off { filter: grayscale(1); opacity: .7; }
  #hud-top .evi { display: none; }
  .hud-sound-btn.off { filter: grayscale(1); opacity: .55; position: relative; }
  .hud-sound-btn.off::after { content: ''; position: absolute; width: 26px; height: 3px; background: #e8554e; border-radius: 2px;
    transform: rotate(-45deg); }
  #hud-stats .held .ico { margin-right: 4px; }
  #hud-stats .held .empty { opacity: .5; }
  #hud-stats .water { color: #1d86c9; }
  #hud-actions { position: fixed; right: 14px; bottom: 18px; z-index: 700; display: grid; grid-template-columns: auto auto;
    grid-template-rows: auto auto; gap: 10px; align-items: end; justify-items: center; }
  .act { border: 0; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-weight: 900; color: #2a1800; touch-action: manipulation; transition: transform .08s; user-select: none; -webkit-user-select: none; }
  .act .i { line-height: 1; }
  .act .l { font-size: 11px; margin-top: 2px; white-space: nowrap; }
  .act:active:not(:disabled) { transform: scale(.9); }
  .act:disabled { filter: grayscale(1) brightness(.9); } /* ทึบ ไม่โปร่ง — ไม่งั้นป้ายในฉากด้านหลังโผล่ทะลุปุ่ม */
  .act.big { grid-column: 2; grid-row: 2; width: 96px; height: 96px; background: radial-gradient(circle at 35% 30%,#ffd76a,#ff9d1a);
    border: 4px solid #fff; box-shadow: 0 5px 0 #b86a00, 0 8px 20px rgba(0,0,0,.35); }
  .act.big .i { font-size: 34px; }
  .act.mid { grid-column: 1; grid-row: 2; width: 72px; height: 72px; background: radial-gradient(circle at 35% 30%,#9ee8ff,#2fa7e0);
    border: 4px solid #fff; box-shadow: 0 5px 0 #17739f, 0 8px 18px rgba(0,0,0,.3); color: #06324a; }
  .act.mid .i { font-size: 26px; }
  .act.small { grid-column: 2; grid-row: 1; width: 58px; height: 58px; background: radial-gradient(circle at 35% 30%,#ffb3c8,#ff5d8f);
    border: 3px solid #fff; box-shadow: 0 4px 0 #b3285a, 0 6px 14px rgba(0,0,0,.3); color: #4a0019; }
  .act.small .i { font-size: 20px; }
  .act.small .l { font-size: 10px; }
  #hud-toast { position: fixed; left: 50%; top: 70px; transform: translateX(-50%); background: rgba(90,58,32,.92); color: #fff;
    padding: 8px 16px; border-radius: 14px; font-size: 14px; font-weight: 700; z-index: 900; opacity: 0; transition: opacity .2s;
    pointer-events: none; max-width: 90vw; text-align: center; border: 2px solid rgba(255,255,255,.2);
    width: max-content; box-sizing: border-box; } /* left:50% ทำให้กว้างได้แค่ครึ่งจอ ถ้าไม่ตั้ง max-content */
  #hud-toast.show { opacity: 1; }
  #hud-modal { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 950; display: none; align-items: flex-end; justify-content: center; }
  #hud-modal.open { display: flex; }
  #hud-modal.center { align-items: center; }
  .sheet { background: #fff8ea; color: #3a2a1a; width: 100%; max-width: 480px; max-height: 75vh; overflow-y: auto;
    border-radius: 22px 22px 0 0; padding: 16px; box-sizing: border-box; border-top: 5px solid #f2c14e; }
  .sheet h3 { margin: 0 0 4px; font-size: 18px; display: flex; justify-content: space-between; align-items: center; }
  .sheet h3 button { background: none; border: 0; font-size: 22px; }
  .sheet .sub { font-size: 12px; color: #8a7355; margin-bottom: 10px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 16px; background: #fff; margin-bottom: 8px;
    box-shadow: 0 2px 0 #ecdcbc; }
  .row .icon { font-size: 30px; width: 40px; text-align: center; }
  .row .txt { flex: 1; font-size: 13px; }
  .row .txt b { font-size: 15px; display: block; }
  .row .txt small { color: #9a8566; }
  .row button { border: 0; border-radius: 14px; padding: 10px 14px; font-weight: 900; background: linear-gradient(180deg,#ffd76a,#ff9d1a);
    color: #3a2000; min-width: 76px; box-shadow: 0 3px 0 #b86a00; }
  .row button:disabled { background: #e2dccf; color: #aaa; box-shadow: none; }
  .row button.free { background: linear-gradient(180deg,#b6f0a5,#6fcf55); color: #1f4a14; box-shadow: 0 3px 0 #3f9a2e; }
  .row.feed { background: #fff7e0; }
  .sheet .hot { color: #e0561a; }
  .results { position: relative; background: #fff8ea; border-radius: 26px; padding: 30px 22px 20px; width: min(340px, 86vw); text-align: center;
    color: #3a2a1a; border: 5px solid #f2c14e; box-shadow: 0 8px 0 #b07a10, 0 18px 40px rgba(0,0,0,.4); }
  .results .ribbon { position: absolute; top: -20px; left: 50%; transform: translateX(-50%); background: #e8554e; color: #fff;
    font-weight: 900; padding: 6px 22px; border-radius: 12px; box-shadow: 0 4px 0 #9e2c26; font-size: 18px; }
  .results h2 { margin: 4px 0 0; font-size: 20px; }
  .results .bigstars span { font-size: 46px; color: #e2d8c2; }
  .results .bigstars span.on { color: #ffc61a; text-shadow: 0 3px 0 #c98a00; }
  .results .score { font-size: 42px; font-weight: 900; color: #e67e00; }
  .results .line { font-size: 14px; color: #6d5a40; margin: 4px 0; }
  .results .best { color: #e67e00; font-weight: 800; }
  .results .next { margin-top: 12px; font-size: 13px; color: #9a8566; }
  .name-tag { font: 700 12px var(--font); color: #6b4220; background: rgba(255,252,245,.92); padding: 1px 9px; border-radius: 10px;
    white-space: nowrap; border: 2px solid #fff; box-shadow: 0 2px 0 rgba(160,100,40,.35); }
  .station-tag { font: 700 13px var(--font); color: #6b4220; background: #fffaf0; padding: 2px 10px; border-radius: 12px;
    border: 2px solid #fff; box-shadow: 0 3px 0 #e0b27a, 0 3px 8px rgba(120,70,20,.2); white-space: nowrap; }
  .work-bar { width: 54px; height: 10px; background: rgba(80,50,30,.35); border-radius: 6px; overflow: hidden; border: 2px solid #fff; }
  .work-bar .fill { height: 100%; width: 0; background: linear-gradient(90deg,#9be38a,#4fc36b); border-radius: 4px; }
  .plot-icon { font-size: 22px; filter: drop-shadow(0 2px 2px rgba(0,0,0,.3)); }
  .plot-icon .bug { display: inline-block; animation: wiggle .4s infinite alternate; }
  .plot-icon .drop, .plot-icon .want { display: inline-block; animation: bob 1.2s ease-in-out infinite; }
  .plot-icon .want { font-size: 16px; background: #fff; border-radius: 12px; padding: 0 5px; box-shadow: 0 2px 0 rgba(0,0,0,.15); }
  .plot-icon .spark { display: inline-block; animation: pop 0.9s ease-in-out infinite; }
  @keyframes bob { 50% { transform: translateY(-4px); } }
  @keyframes pop { 50% { transform: scale(1.25); } }
  @keyframes wiggle { from { transform: rotate(-15deg) translateX(-3px); } to { transform: rotate(15deg) translateX(3px); } }

  /* มือถือ (แนวตั้งแคบ หรือแนวนอนเตี้ย) — ย่อทุกอย่างที่ลอยทับฉาก ให้เห็นแปลง/ตัวละครมากที่สุด */
  @media (max-width: 760px), (max-height: 520px) {
    #hud-top { top: 6px; gap: 3px; }
    #hud-top .pill { gap: 7px; padding: 3px 11px; font-size: 13px; border-width: 2px; box-shadow: 0 3px 0 #8a5a14, 0 4px 10px rgba(0,0,0,.3); }
    #hud-top .score { font-size: 14px; }
    #hud-top .stars span { font-size: 12px; }
    #hud-top small { font-size: 10px; }
    #hud-top .ev { font-size: 10px; padding: 2px 9px; box-shadow: 0 2px 0 #b86a00; }
    #hud-stats { right: 6px; top: 6px; gap: 4px; }
    #hud-stats .coins { font-size: 13px; padding: 2px 10px; border-width: 2px; box-shadow: 0 2px 0 #b07a10; }
    #hud-stats .held { font-size: 11px; padding: 2px 8px; border-radius: 9px; max-width: 40vw; }
    #hud-actions { right: 10px; bottom: 12px; gap: 7px; }
    .act .l { font-size: 10px; margin-top: 1px; }
    .act.big { width: 76px; height: 76px; border-width: 3px; box-shadow: 0 4px 0 #b86a00, 0 6px 14px rgba(0,0,0,.3); }
    .act.big .i { font-size: 26px; }
    .act.mid { width: 58px; height: 58px; border-width: 3px; box-shadow: 0 4px 0 #17739f, 0 6px 12px rgba(0,0,0,.28); }
    .act.mid .i { font-size: 20px; }
    .act.small { width: 46px; height: 46px; border-width: 2px; box-shadow: 0 3px 0 #b3285a, 0 4px 10px rgba(0,0,0,.28); }
    .act.small .i { font-size: 16px; }
    .act.small .l { font-size: 9px; }
    /* ข้างบนมีป้ายเวลา + การ์ดออเดอร์อยู่แล้ว ย้ายลงมาเหนือจอย/ปุ่มแทน */
    #hud-toast { top: auto; bottom: 156px; padding: 4px 11px; font-size: 12px; border-radius: 10px; border-width: 1px; max-width: 70vw; }
    #hud-tip { bottom: 124px; font-size: 11px; padding: 3px 10px; border-radius: 12px; max-width: 70vw; }
    /* มุมขวาบน: [⚙️][🪙] แถวเดียว — แชทพับเป็นไอคอนอยู่ใต้เงิน (ChatPanel.ts) */
    #hud-stats { flex-direction: row; align-items: center; gap: 5px; }
    #hud-menu-btn { display: flex; }
    #hud-hint-btn, .hud-sound-btn, #hud-menu-btn { width: 28px; height: 28px; font-size: 13px; border-width: 1.5px; box-shadow: 0 2px 0 #e0b27a; }
    .hud-sound-btn.off::after { width: 20px; }
    #hud-tray { display: none; flex-direction: column; gap: 5px; top: var(--tray-top, 40px); right: var(--tray-right, 70px); }
    #hud-tray.open { display: flex; }
    /* ของในมือ: ไอคอน + น้ำ/จำนวนครั้ง ในช่องว่างมุมซ้ายบนของกลุ่มปุ่ม (ข้างปุ่มโยน เหนือปุ่มใช้) ไม่มีชื่อ */
    #hud-stats .held { position: fixed; right: 93px; bottom: 95px; width: 58px; min-height: 40px; max-width: none; box-sizing: border-box;
      display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2px; border-radius: 12px;
      font-size: 10px; line-height: 1.15; text-align: center; }
    #hud-stats .held .ico { font-size: 18px; margin: 0; }
    #hud-stats .held .nm, #hud-stats .held.none { display: none; }
    .name-tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
    .station-tag { font-size: 10px; padding: 1px 7px; border-radius: 9px; border-width: 1.5px; box-shadow: 0 2px 0 #b07a10; }
    .work-bar { width: 42px; height: 7px; border-width: 1.5px; }
    .plot-icon { font-size: 16px; }
  }
  /* แนวนอนเตี้ย: กลางจอคือตัวละคร — ตัวช่วย/ข้อความลงไปอยู่แถบล่างระหว่างจอยกับปุ่มกด */
  @media (max-height: 520px) and (orientation: landscape) {
    #hud-tip { bottom: 10px; max-width: calc(100vw - 340px); }
    #hud-toast { bottom: 46px; max-width: calc(100vw - 340px); }
  }
  /* แนวตั้ง: เหนือจอย/ปุ่มกด (ตัวละครอยู่กลางจอ ห่างพอ) กว้างได้เกือบเต็มจอ */
  @media (max-width: 760px) and (orientation: portrait) {
    #hud-tip { bottom: 150px; max-width: 90vw; }
    #hud-toast { bottom: 186px; max-width: 90vw; }
  }
  /* แนวตั้งแคบ: แถบรอบชิดซ้าย (ตรงกลางชนป้ายเงิน) ตัดคำ "ต่อไป"/ไอคอนตัวช่วย/ป้ายเหตุการณ์ใต้แถบ เหลือ emoji ในแถบ */
  @media (max-width: 520px) and (orientation: portrait) {
    #hud-top { left: 6px; transform: none; align-items: flex-start; }
    #hud-top .pill { gap: 5px; padding: 3px 9px; max-width: calc(100vw - 112px); }
    #hud-top .next .w, #hud-top .assist .ic, #hud-top .ev { display: none; }
    #hud-top .evi { display: inline; animation: pulse 1s infinite; }
  }
`
