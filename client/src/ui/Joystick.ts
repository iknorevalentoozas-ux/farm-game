/** จอยสติ๊กเสมือน (DOM) — มุมล่างซ้าย (นิ้วโป้งซ้าย; ปุ่มกระทำอยู่ขวาล่าง) ใช้ Pointer Events รองรับทั้งนิ้วและเมาส์ */
export class Joystick {
  dx = 0
  dy = 0
  constructor(container: HTMLElement) {
    const base = document.createElement('div')
    base.id = 'joystick'
    base.innerHTML = '<div id="joystick-knob"></div>'
    container.appendChild(base)
    const knob = base.firstElementChild as HTMLDivElement

    const style = document.createElement('style')
    style.textContent = `
      #joystick { position: fixed; left: 20px; bottom: 24px; width: 120px; height: 120px; border-radius: 50%;
        background: rgba(255,255,255,0.12); border: 2px solid rgba(255,255,255,0.3); touch-action: none; z-index: 600; }
      #joystick-knob { position: absolute; inset: 0; margin: auto; width: 42%; height: 42%; border-radius: 50%;
        background: rgba(255,255,255,0.55); pointer-events: none; }
      @media (max-width: 760px), (max-height: 520px) { #joystick { left: 12px; bottom: 14px; width: 100px; height: 100px; } }
    `
    document.head.appendChild(style)

    const update = (e: PointerEvent) => {
      const rect = base.getBoundingClientRect()
      let x = e.clientX - (rect.left + rect.width / 2)
      let y = e.clientY - (rect.top + rect.height / 2)
      const R = rect.width * 0.42 // ตามขนาดจอยจริง (จอเล็กจอยเล็กลง)
      const len = Math.hypot(x, y)
      if (len > R) {
        x = (x / len) * R
        y = (y / len) * R
      }
      knob.style.transform = `translate(${x}px, ${y}px)`
      this.dx = x / R
      this.dy = y / R
    }
    const reset = () => {
      knob.style.transform = ''
      this.dx = 0
      this.dy = 0
    }

    base.addEventListener('pointerdown', (e) => {
      base.setPointerCapture(e.pointerId)
      update(e)
    })
    base.addEventListener('pointermove', (e) => {
      if (base.hasPointerCapture(e.pointerId)) update(e)
    })
    base.addEventListener('pointerup', reset)
    base.addEventListener('pointercancel', reset)
  }

  get active() {
    return Math.hypot(this.dx, this.dy) > 0.15
  }
}
