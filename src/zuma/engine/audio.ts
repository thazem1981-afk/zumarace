/**
 * Web Audio effects mixer. Browsers only allow audio after a user gesture, so
 * call `unlock()` from the first click/key press (the title screen does this).
 *
 * All background music has been removed. Only gameplay sound effects and engine audio remain.
 */
export type Sfx = 'pickup' | 'jump' | 'land' | 'hurt' | 'ui' | 'win' | 'lose' | 'dash' | 'countdown' | 'start'

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
    private sfx: GainNode
  private engineBus: GainNode
  private engineGain?: GainNode
  private engineFilter?: BiquadFilterNode
  private engineOscillators: OscillatorNode[] = []
  private engineSoundEnabled = true
  private muted = false
  private sfxVolume = 0.8
  private buffers = new Map<string, AudioBuffer>()

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    this.engineBus = this.ctx.createGain()
    this.sfx.connect(this.master)
    this.engineBus.connect(this.master)
    this.master.connect(this.ctx.destination)
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Volumes in 0..1. */
  setVolumes(sfx: number, muted = false): void {
    this.muted = muted
    this.sfxVolume = Math.max(0, Math.min(1, sfx))
    const t = this.ctx.currentTime
    this.sfx.gain.setTargetAtTime(muted ? 0 : sfx * 0.8, t, 0.05)
    this.engineBus.gain.setTargetAtTime(muted ? 0 : sfx * 0.48, t, 0.05)
  }

  setEngineSoundEnabled(enabled: boolean): void {
    this.engineSoundEnabled = enabled
    if (!enabled) this.updateEngine(0, 0, false, false)
  }

  /** Smooth, speed-responsive rally engine tone; kept on a separate, mute-aware bus. */
  updateEngine(speed: number, throttle: number, turbo: boolean, active: boolean, gear = 1): void {
    const now = this.ctx.currentTime
    if (!this.engineSoundEnabled || !active || this.ctx.state !== 'running') {
      this.engineGain?.gain.setTargetAtTime(0.0001, now, 0.08)
      return
    }

    if (!this.engineGain || !this.engineFilter) {
      this.engineGain = this.ctx.createGain()
      this.engineGain.gain.value = 0.0001
      this.engineFilter = this.ctx.createBiquadFilter()
      this.engineFilter.type = 'lowpass'
      this.engineFilter.Q.value = 0.7
      this.engineFilter.frequency.value = 520
      this.engineFilter.connect(this.engineGain).connect(this.engineBus)

      const fundamental = this.ctx.createOscillator()
      const harmonic = this.ctx.createOscillator()
      const fundamentalLevel = this.ctx.createGain()
      const harmonicLevel = this.ctx.createGain()
      fundamental.type = 'sawtooth'
      harmonic.type = 'triangle'
      fundamental.frequency.value = 48
      harmonic.frequency.value = 96
      fundamentalLevel.gain.value = 0.72
      harmonicLevel.gain.value = 0.18
      fundamental.connect(fundamentalLevel).connect(this.engineFilter)
      harmonic.connect(harmonicLevel).connect(this.engineFilter)
      fundamental.start()
      harmonic.start()
      this.engineOscillators = [fundamental, harmonic]
    }

    const safeSpeed = Math.max(0, Math.min(55, speed))
    const safeThrottle = Math.max(0, Math.min(1, throttle))
    const ratio = [0, 1.9, 1.55, 1.28, 1.08, 0.92, 0.8][Math.max(1, Math.min(6, Math.floor(gear)))]
    const rpmTone = 44 + safeSpeed * 2.15 * ratio + safeThrottle * 13 + (turbo ? 18 : 0)
    this.engineOscillators[0]?.frequency.setTargetAtTime(rpmTone, now, 0.06)
    this.engineOscillators[1]?.frequency.setTargetAtTime(rpmTone * 2.02, now, 0.06)
    this.engineFilter.frequency.setTargetAtTime(420 + safeSpeed * 17 + (turbo ? 260 : 0), now, 0.08)
    const level = 0.018 + Math.min(1, safeSpeed / 50) * 0.065 + safeThrottle * 0.018 + (turbo ? 0.018 : 0)
    this.engineGain.gain.setTargetAtTime(level, now, 0.08)
  }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url)
    if (cached) return cached
    const data = await (await fetch(url)).arrayBuffer()
    const buffer = await this.ctx.decodeAudioData(data)
    this.buffers.set(url, buffer)
    return buffer
  }

  playBuffer(buffer: AudioBuffer, loop = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = loop
    src.connect(this.sfx)
    src.start()
    return src
  }

  play(name: Sfx): void {
    if (this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    const tone = (freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      o.type = type
      o.frequency.setValueAtTime(freq, t + delay)
      o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + delay + dur)
      g.gain.setValueAtTime(0.0001, t + delay)
      g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur)
      o.connect(g).connect(this.sfx)
      o.start(t + delay)
      o.stop(t + delay + dur + 0.05)
    }
    switch (name) {
      case 'pickup': tone(880, 1320, 0.12, 'triangle', 0.35); tone(1320, 1760, 0.16, 'sine', 0.25, 0.06); break
      case 'jump': tone(300, 620, 0.14, 'square', 0.12); break
      case 'land': tone(160, 70, 0.1, 'sine', 0.25); break
      case 'hurt': tone(220, 90, 0.28, 'sawtooth', 0.22); break
      case 'ui': tone(660, 700, 0.06, 'triangle', 0.18); break
      case 'dash': tone(500, 180, 0.18, 'sawtooth', 0.1); break
      case 'countdown': tone(880, 660, 0.16, 'square', 0.2); tone(1320, 990, 0.12, 'triangle', 0.08, 0.02); break
      case 'start': tone(92, 220, 0.34, 'sawtooth', 0.16); [523, 784, 1047].forEach((f, i) => tone(f, f * 1.015, 0.24, 'triangle', 0.2, i * 0.07)); break
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.3, 'triangle', 0.25, i * 0.11)); break
      case 'lose': [392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.38, 'sine', 0.25, i * 0.16)); break
    }
  }

}
