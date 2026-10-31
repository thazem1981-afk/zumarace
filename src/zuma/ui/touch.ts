import type { Action, Input } from '../engine/input'

/** On-screen rally controls: left-side steering/throttle stick and large right-side brake/nitro buttons. */
export class TouchControls {
  private stickId: number | null = null
  private origin = { x: 0, y: 0 }
  private readonly stick: HTMLElement
  private readonly knob: HTMLElement
  private readonly radius = 64
  private readonly onMove: (e: PointerEvent) => void
  private readonly onEnd: (e: PointerEvent) => void

  constructor(root: HTMLElement, private readonly input: Input, private readonly active: () => boolean) {
    const layer = root.querySelector<HTMLElement>('.touch')!
    this.stick = layer.querySelector<HTMLElement>('.touch-stick')!
    this.knob = this.stick.querySelector<HTMLElement>('i')!

    const enable = () => document.body.classList.add('has-touch')
    if (matchMedia('(pointer: coarse)').matches) enable()
    window.addEventListener('touchstart', enable, { once: true, passive: true })
    window.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') {
        enable()
        this.input.method = 'touch'
      }
    }, { capture: true })

    const canvas = document.querySelector<HTMLCanvasElement>('#game')!
    const beginStick = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !this.active() || e.clientX > window.innerWidth * 0.52 || this.stickId !== null) return
      e.preventDefault()
      this.stickId = e.pointerId
      this.origin = { x: e.clientX, y: e.clientY }
      const bounds = this.stick.getBoundingClientRect()
      const width = bounds.width || 122
      const height = bounds.height || 122
      this.stick.style.left = `${Math.max(0, Math.min(window.innerWidth - width, e.clientX - width / 2))}px`
      this.stick.style.top = `${Math.max(0, Math.min(window.innerHeight - height, e.clientY - height / 2))}px`
      this.stick.classList.add('is-active')
      try { (e.currentTarget as HTMLCanvasElement | HTMLElement).setPointerCapture(e.pointerId) }
      catch { /* Keep the stick usable when a WebView declines pointer capture. */ }
    }
    canvas.addEventListener('pointerdown', beginStick)
    this.stick.addEventListener('pointerdown', beginStick)
    this.onMove = e => {
      if (e.pointerId !== this.stickId) return
      let dx = e.clientX - this.origin.x
      let dy = e.clientY - this.origin.y
      const len = Math.hypot(dx, dy)
      if (len > this.radius) {
        dx = (dx / len) * this.radius
        dy = (dy / len) * this.radius
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`
      this.input.setTouchMove(dx / this.radius, -dy / this.radius)
    }
    this.onEnd = e => {
      if (e.pointerId !== this.stickId) return
      this.stickId = null
      this.knob.style.transform = ''
      this.stick.classList.remove('is-active')
      this.input.setTouchMove(0, 0)
      this.stick.style.left = ''
      this.stick.style.top = ''
    }
    window.addEventListener('pointermove', this.onMove, { passive: true })
    window.addEventListener('pointerup', this.onEnd)
    window.addEventListener('pointercancel', this.onEnd)

    for (const btn of layer.querySelectorAll<HTMLElement>('[data-touch]')) {
      const action = btn.dataset.touch as Action
      const up = () => {
        btn.classList.remove('is-down')
        this.input.setTouchButton(action, false)
      }
      btn.addEventListener('pointerdown', e => {
        if (!this.active()) return
        e.preventDefault()
        try { btn.setPointerCapture(e.pointerId) } catch { /* Keep touch usable without pointer capture. */ }
        btn.classList.add('is-down')
        this.input.setTouchButton(action, true)
      })
      btn.addEventListener('pointerup', up)
      btn.addEventListener('pointercancel', up)
      btn.addEventListener('lostpointercapture', up)
    }
  }
}
