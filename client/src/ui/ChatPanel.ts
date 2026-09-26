import type { Socket } from 'socket.io-client'

interface ChatMessage {
  source: 'room' | 'farm'
  name: string
  text: string
  t: number
}
interface Person {
  uuid: string
  name: string
  avatar: string | null
}
interface Seat {
  position: number
  locked: boolean
  uuid: string | null
  name: string | null
  avatar: string | null
  muted: boolean
}
interface RoomInfo {
  topic: string | null
  owner: Person | null
  participants: Person[]
  speakers: Seat[]
}

type Tab = 'chat' | 'people' | 'seats'

/**
 * แชทรวม + ข้อมูลห้อง YelloTalk จริง — 3 แท็บ: แชท (ห้อง + ฟาร์ม), คนในห้อง, คนบนหลุม (10 หลุม)
 * ข้อมูลมาจาก server ฟาร์ม (bridge.js ดึงจาก backend บอทอีกที) — ไม่มีสะพาน = room เป็น null โชว์แค่แชทฟาร์ม
 * แชทย้อนหลังขอด้วย chat:hello หลัง mount (และทุกครั้งที่ต่อใหม่) ได้ chat:history กลับมา
 */
export function mountChatPanel(container: HTMLElement, socket: Socket) {
  const root = document.createElement('div')
  root.id = 'chat-panel'
  root.innerHTML = `
    <div id="chat-head">
      <button id="chat-toggle" type="button"></button>
      <div id="chat-tabs">
        <button type="button" data-tab="chat">💬 แชท</button>
        <button type="button" data-tab="people">👥 <span class="n-people">0</span></button>
        <button type="button" data-tab="seats">🎤 <span class="n-seats">0</span></button>
      </div>
    </div>
    <div id="chat-room"></div>
    <div id="chat-body">
      <div id="chat-messages" class="pane" data-pane="chat"></div>
      <div class="pane" data-pane="people"><div id="chat-people"></div></div>
      <div class="pane" data-pane="seats"><div id="chat-seats"></div></div>
    </div>
    <form id="chat-form">
      <input id="chat-input" type="text" maxlength="500" placeholder="พิมพ์แชท…" autocomplete="off" />
      <button type="submit">ส่ง</button>
    </form>
    <div id="chat-peek"></div>
  `
  container.appendChild(root)
  injectStyles()

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!
  const messagesEl = $<HTMLDivElement>('#chat-messages')
  const inputEl = $<HTMLInputElement>('#chat-input')
  const toggleEl = $<HTMLButtonElement>('#chat-toggle')
  const peekEl = $<HTMLDivElement>('#chat-peek')

  let unread = 0
  let tab: Tab = 'chat'
  let room: RoomInfo | null = null
  let farmUuids = new Set<string>()
  let peekTimer = 0

  const collapsed = () => root.classList.contains('collapsed')
  const renderToggle = () => {
    const badge = unread && collapsed() ? ` <span class="unread">${unread > 99 ? '99+' : unread}</span>` : ''
    toggleEl.innerHTML = collapsed() ? `💬<span class="lbl"> แชท</span>${badge}` : '✕'
  }
  const setTab = (t: Tab) => {
    tab = t
    root.querySelectorAll<HTMLButtonElement>('#chat-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t))
    root.querySelectorAll<HTMLDivElement>('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t))
    $('#chat-form').style.display = t === 'chat' ? '' : 'none'
    if (t === 'chat') messagesEl.scrollTop = messagesEl.scrollHeight
  }

  // มือถือ (แนวตั้งหรือแนวนอน) เริ่มแบบพับไว้ ไม่ให้แชทบังพื้นที่เล่น — พับอยู่มีตัวเลขข้อความใหม่ + โผล่ข้อความล่าสุดแวบนึง
  if (window.innerWidth < 700 || window.innerHeight < 520) root.classList.add('collapsed')
  toggleEl.addEventListener('click', () => {
    root.classList.toggle('collapsed')
    if (!collapsed()) {
      unread = 0
      peekEl.classList.remove('show')
      setTab(tab)
    }
    renderToggle()
  })
  root.querySelectorAll<HTMLButtonElement>('#chat-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab as Tab)))
  setTab('chat')
  renderToggle()

  function line(msg: ChatMessage) {
    const el = document.createElement('div')
    el.className = `chat-line ${msg.source}`
    const badge = msg.source === 'room' ? 'ห้อง' : 'ฟาร์ม'
    el.innerHTML = `<span class="badge">${badge}</span><b>${esc(msg.name)}</b>: ${esc(msg.text)}`
    return el
  }
  function addMessage(msg: ChatMessage, live: boolean) {
    const stick = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40
    messagesEl.appendChild(line(msg))
    while (messagesEl.childElementCount > 120) messagesEl.firstElementChild?.remove()
    if (stick || !live) messagesEl.scrollTop = messagesEl.scrollHeight
    if (live && collapsed()) {
      unread++
      renderToggle()
      peekEl.innerHTML = `<b>${esc(msg.name)}</b>: ${esc(msg.text)}`
      peekEl.classList.add('show')
      clearTimeout(peekTimer)
      peekTimer = window.setTimeout(() => peekEl.classList.remove('show'), 4000)
    }
  }

  function avatar(p: { name: string | null; avatar: string | null }, cls = 'av') {
    const initial = esc((p.name || '?').trim().charAt(0) || '?')
    // รูปโหลดไม่ขึ้น (ลิงก์เสีย/บล็อก) = ซ่อนรูป โชว์ตัวอักษรแรกแทน
    return p.avatar
      ? `<span class="${cls}"><img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><i>${initial}</i></span>`
      : `<span class="${cls}"><i>${initial}</i></span>`
  }

  function renderRoom() {
    const roomEl = $<HTMLDivElement>('#chat-room')
    const people = room?.participants || []
    const seats = room?.speakers || []
    const onStage = seats.filter((s) => s.uuid)
    $('.n-people').textContent = String(people.length)
    $('.n-seats').textContent = String(onStage.length)
    roomEl.innerHTML = room?.topic ? `🏠 ${esc(room.topic)}` : ''
    roomEl.style.display = room?.topic ? '' : 'none'

    const peopleEl = $<HTMLDivElement>('#chat-people')
    if (!room) peopleEl.innerHTML = '<p class="none">ยังไม่ได้เชื่อมห้อง YelloTalk (ตั้ง BRIDGE_BOT_ID ที่ server)</p>'
    else if (!people.length) peopleEl.innerHTML = '<p class="none">ไม่มีใครในห้อง</p>'
    else {
      const ownerId = room.owner?.uuid
      peopleEl.innerHTML = people
        .map(
          (p) => `<div class="person">${avatar(p)}<span class="nm">${esc(p.name)}</span>
            ${p.uuid === ownerId ? '<span class="tag own">👑</span>' : ''}${farmUuids.has(p.uuid) ? '<span class="tag farm">🌾 เล่นอยู่</span>' : ''}</div>`,
        )
        .join('')
    }

    const seatsEl = $<HTMLDivElement>('#chat-seats')
    if (!room) {
      seatsEl.innerHTML = '<p class="none">ยังไม่ได้เชื่อมห้อง YelloTalk</p>'
      return
    }
    const owner = room.owner ? `<div class="owner">${avatar(room.owner)}<span class="nm">👑 ${esc(room.owner.name)}</span></div>` : ''
    const grid = seats.length
      ? seats
          .map((s) => {
            if (s.locked) return `<div class="seat locked"><span class="av"><i>🔒</i></span><small>ล็อก</small></div>`
            if (!s.uuid) return `<div class="seat empty"><span class="av"><i>${s.position + 1}</i></span><small>ว่าง</small></div>`
            return `<div class="seat ${s.muted ? '' : 'live'}">${avatar(s)}<small>${esc(s.name || '')}</small><em>${s.muted ? '🔇' : '🎙️'}</em></div>`
          })
          .join('')
      : '<p class="none">ยังไม่มีข้อมูลหลุม</p>'
    seatsEl.innerHTML = `${owner}<div class="seat-grid">${grid}</div>`
  }

  socket.on('chat:history', ({ messages, room: r }: { messages: ChatMessage[]; room: RoomInfo | null }) => {
    messagesEl.innerHTML = ''
    for (const m of messages) addMessage(m, false)
    room = r
    renderRoom()
  })
  socket.on('chat:message', (msg: ChatMessage) => addMessage(msg, true))
  socket.on('room:info', (r: RoomInfo) => {
    room = r
    renderRoom()
  })
  // ใครในห้องกำลังเล่นฟาร์มอยู่ (uuid ตรงกันเพราะตอนเข้าเกมเลือกตัวเองจากรายชื่อคนในห้อง)
  socket.on('world:state', ({ players }: { players: { uuid: string }[] }) => {
    const next = new Set(players.map((p) => p.uuid))
    if (next.size !== farmUuids.size || [...next].some((u) => !farmUuids.has(u))) {
      farmUuids = next
      if (tab === 'people' && !collapsed()) renderRoom()
    }
  })
  socket.on('connect', () => socket.emit('chat:hello'))
  socket.emit('chat:hello')
  renderRoom()

  $<HTMLFormElement>('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const text = inputEl.value.trim()
    if (!text) return
    socket.emit('chat:send', { text })
    inputEl.value = ''
  })
}

function esc(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML.replace(/"/g, '&quot;')
}

function injectStyles() {
  if (document.getElementById('chat-panel-styles')) return
  const style = document.createElement('style')
  style.id = 'chat-panel-styles'
  style.textContent = `
    #chat-panel { position: fixed; right: 8px; top: 175px; width: min(290px, 70vw); max-height: 340px; display: flex; flex-direction: column;
      background: rgba(10, 18, 8, 0.78); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; overflow: hidden; z-index: 500;
      backdrop-filter: blur(4px); font-size: 12px; color: #eef6ea; }
    #chat-head { display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.08); padding: 3px; }
    #chat-toggle { border: none; background: transparent; color: #eef6ea; padding: 4px 8px; cursor: pointer; font-size: 12px; white-space: nowrap; }
    #chat-tabs { display: flex; gap: 3px; flex: 1; justify-content: flex-end; }
    #chat-tabs button { border: none; background: rgba(255,255,255,0.08); color: #cfe0c9; padding: 4px 8px; border-radius: 8px; font-size: 11px;
      cursor: pointer; white-space: nowrap; }
    #chat-tabs button.on { background: #4e8552; color: #fff; font-weight: 700; }
    #chat-room { padding: 3px 8px; font-size: 11px; color: #ffe39a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-bottom: 1px solid rgba(255,255,255,0.08); }
    #chat-body { flex: 1; min-height: 0; display: flex; }
    .pane { display: none; flex: 1; overflow-y: auto; padding: 6px 8px; max-height: 240px; }
    .pane.on { display: block; }
    #chat-messages.on { display: flex; flex-direction: column; gap: 4px; }
    #chat-panel.collapsed { width: auto; background: rgba(10,18,8,0.6); }
    #chat-panel.collapsed #chat-tabs, #chat-panel.collapsed #chat-room, #chat-panel.collapsed #chat-body,
      #chat-panel.collapsed #chat-form { display: none !important; }
    .chat-line { line-height: 1.4; word-break: break-word; }
    .chat-line .badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 6px; margin-right: 5px; vertical-align: middle; }
    .chat-line.room .badge { background: #3a6fd8; }
    .chat-line.farm .badge { background: #4e8552; }
    #chat-form { display: flex; border-top: 1px solid rgba(255,255,255,0.12); }
    #chat-input { flex: 1; min-width: 0; border: none; background: transparent; color: white; padding: 8px; outline: none; font-size: 12px; }
    #chat-form button { border: none; background: #d98f3a; color: #1b1204; font-weight: 700; padding: 0 12px; cursor: pointer; }
    #chat-toggle .unread { display: inline-block; min-width: 16px; padding: 0 4px; border-radius: 8px; background: #e8554e; color: #fff;
      font-size: 10px; font-weight: 800; text-align: center; margin-left: 2px; }
    .av { position: relative; flex: none; width: 24px; height: 24px; border-radius: 50%; overflow: hidden; background: #3c6b3f;
      display: inline-flex; align-items: center; justify-content: center; }
    .av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .av i { font-style: normal; font-weight: 800; font-size: 11px; }
    .person, .owner { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
    .person .nm, .owner .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag { font-size: 9px; padding: 1px 5px; border-radius: 6px; white-space: nowrap; }
    .tag.farm { background: #4e8552; }
    .owner { border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 6px; padding-bottom: 6px; color: #ffe39a; }
    .seat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px 4px; }
    .seat { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
    .seat .av { width: 32px; height: 32px; }
    .seat small { font-size: 9px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cfe0c9; }
    .seat em { position: absolute; top: 18px; right: 2px; font-style: normal; font-size: 10px; }
    .seat.live .av { box-shadow: 0 0 0 2px #7ee06a; }
    .seat.empty .av { background: rgba(255,255,255,0.08); border: 1px dashed rgba(255,255,255,0.25); }
    .seat.empty i, .seat.locked i { color: rgba(255,255,255,0.45); font-size: 11px; }
    .seat.locked .av { background: rgba(0,0,0,0.3); }
    .none { color: #a9c2a3; font-size: 11px; margin: 4px 0; }
    #chat-peek { display: none; }
    #chat-panel.collapsed #chat-peek.show { display: block; position: absolute; right: 0; top: calc(100% + 4px); width: min(220px, 60vw);
      background: rgba(10,18,8,0.8); border-radius: 10px; padding: 5px 8px; font-size: 11px; line-height: 1.35; word-break: break-word;
      pointer-events: none; animation: peek .2s ease-out; }
    #chat-panel.collapsed { overflow: visible; }
    @keyframes peek { from { opacity: 0; transform: translateY(-4px); } }
    @media (max-width: 760px), (max-height: 520px) {
      /* ใต้แถว [⚙️][🪙] ของ Hud — พับอยู่เหลือแค่ไอคอน 💬 + ตัวเลขข้อความใหม่ */
      #chat-panel { top: 40px; right: 6px; width: min(260px, 64vw); max-height: 55vh; font-size: 11px; border-radius: 10px; }
      #chat-panel.collapsed .lbl { display: none; }
      #chat-toggle { padding: 3px 7px; font-size: 11px; }
      #chat-tabs button { padding: 3px 6px; font-size: 10px; }
      .pane { max-height: calc(55vh - 80px); padding: 5px 6px; }
      #chat-input { padding: 6px; font-size: 16px; } /* < 16px แล้ว iOS ซูมหน้าตอนแตะช่องพิมพ์ */
      .seat .av { width: 28px; height: 28px; }
    }
  `
  document.head.appendChild(style)
}
