import { SERVER_URL } from '../net/socket'

export interface Identity {
  uuid: string
  name: string
}

interface Participant {
  uuid: string
  name?: string
  pin_name?: string
  avatar?: string | null
}

/** หน้าจอเลือกตัวตนก่อนเข้าเกม — ดึงคนในห้องจริงจาก farm-game server (ผ่าน bridge ไป backend เดิม)
 *  มาให้เลือก และมีช่องกรอกชื่อเองไว้เสมอสำหรับตอน dev/ทดสอบที่ยังไม่มีบอทอยู่ในห้อง */
export function showLoginOverlay(container: HTMLElement): Promise<Identity> {
  return new Promise((resolve) => {
    const root = document.createElement('div')
    root.id = 'login-overlay'
    root.innerHTML = `
      <div class="login-card">
        <h1>🌾 Farm Game</h1>
        <p class="hint">เลือกตัวเองจากรายชื่อคนในห้อง</p>
        <div class="participant-list" id="participant-list"><p class="empty">กำลังโหลด…</p></div>
        <div class="manual">
          <p class="hint">หรือทดสอบด้วยชื่อที่ตั้งเอง</p>
          <input id="manual-name" type="text" placeholder="ชื่อเล่น" maxlength="24" />
          <button id="manual-join">เข้าเกม (โหมดทดสอบ)</button>
        </div>
      </div>
    `
    container.appendChild(root)
    injectStyles()

    const listEl = root.querySelector<HTMLDivElement>('#participant-list')!
    // ช่องกรอกชื่อเอง (โหมดทดสอบ) ซ่อนไว้ ถ้ามีรายชื่อคนในห้องให้เลือก — เปิดดูได้ด้วย ?dev=1
    // ไม่มีรายชื่อ (ไม่ได้ต่อห้อง/ห้องว่าง/ต่อ server ไม่ได้) ยังโชว์ ไม่งั้นไม่มีทางเข้าเกมเลย
    const devMode = new URLSearchParams(location.search).has('dev')
    const manualEl = root.querySelector<HTMLDivElement>('.manual')!
    manualEl.style.display = 'none'
    const showManual = () => (manualEl.style.display = '')
    if (devMode) showManual()
    fetch(`${SERVER_URL}/api/participants`)
      .then((r) => r.json())
      .then((data: { participants: Participant[]; ownerUuid?: string | null }) => {
        const list = data.participants || []
        if (!list.length) {
          showManual()
          listEl.innerHTML =
            '<p class="empty">ไม่มีใครในห้องตอนนี้ (หรือยังไม่ได้ตั้งค่าสะพานเชื่อมบอท) — ใช้โหมดทดสอบด้านล่างได้เลย</p>'
          return
        }
        listEl.innerHTML = ''
        for (const p of list) {
          const btn = document.createElement('button')
          btn.className = 'participant-btn'
          const label = p.name || p.pin_name || p.uuid
          if (p.avatar) {
            const img = document.createElement('img')
            img.src = p.avatar
            img.referrerPolicy = 'no-referrer'
            img.onerror = () => img.remove()
            btn.appendChild(img)
          }
          btn.appendChild(document.createTextNode(p.uuid === data.ownerUuid ? `👑 ${label}` : label))
          btn.onclick = () => finish({ uuid: p.uuid, name: label || 'ผู้เล่น' })
          listEl.appendChild(btn)
        }
      })
      .catch(() => {
        showManual()
        listEl.innerHTML =
          '<p class="empty">เชื่อม farm-game server ไม่ได้ — เช็คว่ารัน npm run dev ใน server/ อยู่ไหม</p>'
      })

    const manualBtn = root.querySelector<HTMLButtonElement>('#manual-join')!
    const manualInput = root.querySelector<HTMLInputElement>('#manual-name')!
    const submitManual = () => {
      const name = manualInput.value.trim() || `ทดสอบ${Math.floor(Math.random() * 1000)}`
      finish({ uuid: `dev-${Math.random().toString(36).slice(2, 10)}`, name })
    }
    manualBtn.onclick = submitManual
    manualInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitManual()
    })

    function finish(identity: Identity) {
      root.remove()
      resolve(identity)
    }
  })
}

function injectStyles() {
  if (document.getElementById('login-overlay-styles')) return
  const style = document.createElement('style')
  style.id = 'login-overlay-styles'
  style.textContent = `
    #login-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at top, #2c4a2f, #12200f); z-index: 1000; }
    .login-card { background: rgba(15, 25, 12, 0.92); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px 22px; color: #eef6ea; width: min(340px, calc(100vw - 32px)); box-sizing: border-box; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
    .login-card h1 { margin: 0 0 4px; font-size: 22px; }
    .hint { font-size: 12px; color: #a9c2a3; margin: 8px 0 6px; }
    .participant-list { display: flex; flex-wrap: wrap; gap: 6px; max-height: 220px; overflow-y: auto; margin-bottom: 8px; }
    .participant-btn { display: inline-flex; align-items: center; gap: 6px; background: #3c6b3f; border: none; color: white; padding: 6px 12px 6px 8px; border-radius: 10px; cursor: pointer; font-size: 13px; }
    .participant-btn img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; }
    .participant-btn:hover { background: #4e8552; }
    .empty { font-size: 12px; color: #8fa989; }
    .manual { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; margin-top: 6px; }
    .manual input { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid #3c6b3f; background: #0f1a0d; color: white; margin-bottom: 8px; }
    .manual button { width: 100%; padding: 9px; border: none; border-radius: 8px; background: #d98f3a; color: #1b1204; font-weight: 700; cursor: pointer; }
    .manual button:hover { background: #eaa04c; }
  `
  document.head.appendChild(style)
}
