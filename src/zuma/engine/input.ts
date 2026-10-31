/**
 * Unified driving input: keyboard, standard gamepad and touch all feed one steering/throttle
 * state plus held actions. Movement axes remain independent so full throttle and full steering
 * can be used together without diagonal speed loss.
 */
export type Action = 'brake' | 'drift' | 'turbo' | 'throttle' | 'pause' | 'confirm' | 'back' | 'interact' | 'jump' | 'dash' | 'sprint'
export type InputMethod = 'keyboard' | 'gamepad' | 'touch'

const KEY_BINDINGS: Record<Action, string[]> = {
  brake: ['Space'],
  drift: ['Space'],
  turbo: ['ShiftLeft', 'ShiftRight', 'KeyF'],
  throttle: [],
  jump: ['Space'], dash: ['KeyF'], sprint: ['ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  back: [],
  interact: ['KeyE'],
}
const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
}
// Standard gamepad: A=0, B=1, X=2, LB=4, RB=5, LT=6, RT=7, Start=9.
const PAD_BINDINGS: Record<Action, number[]> = {
  brake: [6], drift: [4], turbo: [2, 5], throttle: [], jump: [0], dash: [2, 5], sprint: [4, 10],
  pause: [9], confirm: [0], back: [1], interact: [3],
}

export class Input {
  /** Continuous driving intent in [-1, 1]: x = steer right, y = throttle (negative brakes/reverses). */
  readonly move = { x: 0, y: 0 }
  /** Legacy look state remains available to the retained starter modules. */
  readonly look = { x: 0, y: 0 }
  method: InputMethod = 'keyboard'
  /** Driving steering sensitivity, adjustable in Settings. */
  sensitivity = 1
  invertY = false

  private keys = new Set<string>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private touchMove = { x: 0, y: 0 }
  private touchButtons = new Set<Action>()
  private padPrev: boolean[] = []
  private padIndex = -1
  private padId = ''
  private listeners: Array<() => void> = []
  constructor(private readonly canvas?: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', e => {
      if (e.repeat) return
      this.keys.add(e.code)
      this.method = 'keyboard'
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
        if (codes.includes(e.code)) this.pressed_.add(action)
      }
      const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea')
      if (!typing && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault()
    })
    on(window, 'keyup', e => this.keys.delete(e.code))
    on(window, 'blur', () => this.keys.clear())
    on(window, 'mousemove', e => {
      if (document.pointerLockElement === this.canvas) {
        this.look.x += e.movementX * 0.002
        this.look.y += e.movementY * 0.002
      }
    })
    on(window, 'gamepaddisconnected', e => {
      if (e.gamepad.index === this.padIndex) this.resetPad()
    })
  }

  /** Touch controls feed steering/throttle from the virtual stick and actions from buttons. */
  setTouchMove(x: number, y: number): void {
    this.method = 'touch'
    this.touchMove.x = clamp(x, -1, 1)
    this.touchMove.y = clamp(y, -1, 1)
  }

  setTouchButton(action: Action, down: boolean): void {
    this.method = 'touch'
    if (down && !this.touchButtons.has(action)) this.pressed_.add(action)
    if (down) this.touchButtons.add(action)
    else this.touchButtons.delete(action)
  }

  private resetPad(): void {
    this.padPrev = []
    this.padIndex = -1
    this.padId = ''
  }

  /** Sample once per rendered frame. */
  update(_frameSeconds?: number): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (k(MOVE_KEYS.right) ? 1 : 0) - (k(MOVE_KEYS.left) ? 1 : 0)
    let y = (k(MOVE_KEYS.up) ? 1 : 0) - (k(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
      if (k(codes)) this.held_.add(action)
    }
    for (const action of this.touchButtons) this.held_.add(action)
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) {
      x = this.touchMove.x
      y = this.touchMove.y
    }

    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad) {
      if (pad.index !== this.padIndex || pad.id !== this.padId) this.padPrev = []
      this.padIndex = pad.index
      this.padId = pad.id
      const dead = (v: number) => Math.abs(v) < 0.16 ? 0 : Math.sign(v) * ((Math.abs(v) - 0.16) / 0.84)
      const lx = dead(pad.axes[0] ?? 0)
      const ly = dead(pad.axes[1] ?? 0)
      const dx = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0)
      const dy = (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0)
      const rt = clamp(pad.buttons[7]?.value ?? 0, 0, 1)
      const lt = clamp(pad.buttons[6]?.value ?? 0, 0, 1)
      const padActive = lx !== 0 || ly !== 0 || dx !== 0 || dy !== 0 || rt > 0.08 || lt > 0.08 || pad.buttons.some(b => b.pressed)
      if (padActive) this.method = 'gamepad'
      if (lx !== 0 || ly !== 0 || dx !== 0 || dy !== 0) {
        x = dx || lx
        y = dy || -ly
      }
      if (rt > 0.08 || lt > 0.08) y = rt - lt
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) {
        if (buttons.some(i => pad.buttons[i]?.pressed)) this.held_.add(action)
        if (buttons.some(i => pad.buttons[i]?.pressed && !this.padPrev[i])) this.pressed_.add(action)
      }
      this.padPrev = pad.buttons.map(b => b.pressed)
    } else this.resetPad()

    this.move.x = clamp(x, -1, 1)
    this.move.y = clamp(y, -1, 1)
  }

  held(action: Action): boolean { return this.held_.has(action) }
  pressed(action: Action): boolean { return this.pressed_.has(action) }
  consume(action: Action): boolean { return this.pressed_.delete(action) }

  endFrame(): void { this.pressed_.clear() }

  addTouchLook(dx: number, dy: number): void {
    this.method = 'touch'
    this.look.x += dx * 0.006 * this.sensitivity
    this.look.y += dy * 0.006 * this.sensitivity
  }

  takeLook(): { x: number; y: number } {
    const result = { x: this.look.x * this.sensitivity, y: this.look.y * this.sensitivity * (this.invertY ? -1 : 1) }
    this.look.x = 0
    this.look.y = 0
    return result
  }

  lockPointer(): void {
    if (this.canvas?.requestPointerLock && document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock()
  }

  unlockPointer(): void {
    if (document.pointerLockElement) void document.exitPointerLock?.()
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners = []
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(v) ? v : 0))
}
