import * as THREE from 'three'
import { TIME_START, type StageConditions, type WeatherId } from './environment'

type SkyKey = { t: number; top: number; horizon: number; sun: number; sunI: number; amb: number; fog: number }
/** Sky colours along the sun's path (0 sunrise → 1 sunset → 1.5 deep night). */
const SKY_KEYS: SkyKey[] = [
  { t: -0.1, top: 0x0b1530, horizon: 0x2a2f4a, sun: 0x6f7fb0, sunI: 0.25, amb: 0.45, fog: 0x1d2236 },
  { t: 0.04, top: 0x3d5a8a, horizon: 0xf2a86a, sun: 0xffb27a, sunI: 1.6, amb: 1.1, fog: 0xd9a483 },
  { t: 0.2, top: 0x5f9fd8, horizon: 0xf3dcb4, sun: 0xffe2b8, sunI: 3, amb: 1.8, fog: 0xe6d4b6 },
  { t: 0.5, top: 0x4a8fd6, horizon: 0xcfe3f0, sun: 0xfff3dc, sunI: 3.6, amb: 2.1, fog: 0xd6e2ea },
  { t: 0.82, top: 0x5a82b8, horizon: 0xf0c890, sun: 0xffd09a, sunI: 3, amb: 1.8, fog: 0xe8c99a },
  { t: 0.96, top: 0x3a3d6e, horizon: 0xf07a4a, sun: 0xff8a4a, sunI: 1.7, amb: 1.1, fog: 0xc87a5a },
  { t: 1.12, top: 0x101834, horizon: 0x3a2f4f, sun: 0x8090c0, sunI: 0.35, amb: 0.5, fog: 0x222640 },
  { t: 1.6, top: 0x060b1c, horizon: 0x141a30, sun: 0x8090c0, sunI: 0.3, amb: 0.42, fog: 0x10142a },
]

const WEATHER_TINT: Record<WeatherId, { fogNear: number; fogFar: number; dim: number; grey: number }> = {
  clear: { fogNear: 180, fogFar: 760, dim: 1, grey: 0 },
  cloudy: { fogNear: 150, fogFar: 600, dim: 0.72, grey: 0.35 },
  rain: { fogNear: 60, fogFar: 340, dim: 0.55, grey: 0.55 },
  fog: { fogNear: 12, fogFar: 140, dim: 0.62, grey: 0.6 },
  snow: { fogNear: 40, fogFar: 260, dim: 0.75, grey: 0.5 },
  sandstorm: { fogNear: 18, fogFar: 170, dim: 0.66, grey: 0.25 },
}

/**
 * Dynamic sky, lighting and precipitation. Time of day advances slowly while racing and the
 * weather intensity drifts, so a long stage visibly changes from start to finish.
 */
export class Atmosphere {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3)
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x554433, 2)
  private readonly sky: THREE.Mesh
  private readonly skyMat: THREE.ShaderMaterial
  private readonly precip: THREE.Points
  private readonly precipMat: THREE.PointsMaterial
  private readonly precipVel: Float32Array
  private readonly fog = new THREE.Fog(0xffffff, 100, 500)
  private readonly lightning = new THREE.AmbientLight(0xdfe8ff, 0)
  private conditions!: StageConditions
  /** Sun progress; see SKY_KEYS. */
  sunT = 0.4
  intensity = 1
  private time = 0
  private flash = 0
  private readonly tmpA = new THREE.Color()
  private readonly tmpB = new THREE.Color()

  constructor(private readonly scene: THREE.Scene, shadowSize: number) {
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(shadowSize, shadowSize)
    const cam = this.sun.shadow.camera
    cam.left = -70; cam.right = 70; cam.top = 70; cam.bottom = -70; cam.near = 1; cam.far = 400
    this.sun.shadow.bias = -0.0004
    scene.add(this.sun, this.sun.target, this.hemi, this.lightning)
    scene.fog = this.fog

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunColor: { value: new THREE.Color() }, stars: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float stars; varying vec3 vDir;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        void main(){ float y = max(vDir.y, 0.0); vec3 col = mix(horizon, top, pow(y, 0.55));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.35);
          if (stars > 0.0 && y > 0.05) { vec3 c = floor(vDir * 300.0); float st = step(0.9975, h(c)); col += vec3(st) * stars; }
          gl_FragColor = vec4(col, 1.0); }`,
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), this.skyMat)
    this.sky.frustumCulled = false
    scene.add(this.sky)

    const count = 5000
    const pos = new Float32Array(count * 3)
    this.precipVel = new Float32Array(count)
    for (let i = 0; i < count; i += 1) {
      pos[i * 3] = (Math.random() - 0.5) * 80
      pos[i * 3 + 1] = Math.random() * 40
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80
      this.precipVel[i] = 0.7 + Math.random() * 0.6
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.precipMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.6, depthWrite: false })
    this.precip = new THREE.Points(g, this.precipMat)
    this.precip.frustumCulled = false
    this.precip.visible = false
    scene.add(this.precip)
  }

  get weather(): WeatherId { return this.conditions.weather }
  /** 0 = full daylight, 1 = darkest night; drives headlights. */
  get darkness(): number { return THREE.MathUtils.clamp(this.sunT < 0 ? -this.sunT * 8 : (this.sunT - 1.0) * 8, 0, 1) }
  /** Road wetness for the track material. */
  get wetness(): number { return this.conditions.weather === 'rain' ? 0.6 + 0.4 * this.intensity : this.conditions.weather === 'snow' ? 0.3 : 0 }

  setConditions(conditions: StageConditions): void {
    this.conditions = conditions
    this.sunT = TIME_START[conditions.time]
    this.intensity = 1
    this.time = 0
    const w = conditions.weather
    this.precip.visible = w === 'rain' || w === 'snow' || w === 'sandstorm'
    this.precipMat.color.set(w === 'sandstorm' ? conditions.biome.dust : w === 'rain' ? 0xaebfd0 : 0xffffff)
    this.precipMat.size = w === 'rain' ? 0.09 : w === 'snow' ? 0.22 : 0.16
    this.precipMat.opacity = w === 'rain' ? 0.55 : w === 'snow' ? 0.9 : 0.5
    this.apply()
  }

  /** Advance dynamic time and weather. `racing` controls whether the clock moves. */
  update(dt: number, focus: THREE.Vector3, racing: boolean, reducedMotion: boolean): void {
    this.time += dt
    // About 6 minutes of racing moves the sun through a quarter of its arc.
    if (racing) this.sunT += dt / 1400
    if (this.sunT > 1.6) this.sunT = -0.1
    this.intensity = THREE.MathUtils.clamp(0.75 + Math.sin(this.time * 0.05) * 0.25 + Math.sin(this.time * 0.13) * 0.1, 0.4, 1)
    if (this.conditions.weather === 'rain' && !reducedMotion && racing) {
      if (this.flash <= 0 && Math.random() < dt * 0.025) this.flash = 0.35
      this.flash = Math.max(0, this.flash - dt)
      this.lightning.intensity = this.flash > 0 ? (Math.sin(this.flash * 60) > 0 ? 2.5 : 0.4) : 0
    } else this.lightning.intensity = 0
    this.apply()
    this.sky.position.copy(focus)
    const dir = this.sunDirection()
    this.sun.position.copy(focus).addScaledVector(dir, 160)
    this.sun.target.position.copy(focus)
    if (this.precip.visible) this.updatePrecip(dt, focus)
  }

  private sunDirection(): THREE.Vector3 {
    const night = this.sunT > 1.05 || this.sunT < -0.02
    // At night the "sun" becomes moonlight from high above.
    const a = night ? Math.PI * 0.35 : THREE.MathUtils.clamp(this.sunT, 0.02, 0.98) * Math.PI
    return new THREE.Vector3(Math.cos(a) * 0.8, Math.max(0.12, Math.sin(a)), 0.45).normalize()
  }

  private apply(): void {
    const k = this.keyAt(this.sunT)
    const w = WEATHER_TINT[this.conditions.weather]
    const grey = w.grey * this.intensity
    const dim = THREE.MathUtils.lerp(1, w.dim, this.intensity)
    const greyC = new THREE.Color(0x9aa3ab)
    const top = this.tmpA.copy(k.top).lerp(greyC, grey).multiplyScalar(THREE.MathUtils.lerp(1, 0.8, grey))
    const horizon = this.tmpB.copy(k.horizon).lerp(this.conditions.weather === 'sandstorm' ? new THREE.Color(this.conditions.biome.dust) : greyC, grey)
    this.skyMat.uniforms.top.value.copy(top)
    this.skyMat.uniforms.horizon.value.copy(horizon)
    this.skyMat.uniforms.sunDir.value.copy(this.sunDirection())
    this.skyMat.uniforms.sunColor.value.copy(k.sun).multiplyScalar(this.conditions.weather === 'clear' ? 1 : 0.25)
    this.skyMat.uniforms.stars.value = this.conditions.weather === 'clear' ? this.darkness : 0
    this.sun.color.copy(k.sun)
    this.sun.intensity = k.sunI * dim
    this.hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.4)
    this.hemi.groundColor.set(this.conditions.biome.ground).multiplyScalar(0.45)
    this.hemi.intensity = k.amb * THREE.MathUtils.lerp(1, 0.85, grey)
    const fogColor = new THREE.Color(k.fog).lerp(horizon, 0.5)
    if (this.conditions.weather === 'sandstorm') fogColor.lerp(new THREE.Color(this.conditions.biome.dust), 0.6 * this.intensity)
    this.fog.color.copy(fogColor)
    const near = THREE.MathUtils.lerp(WEATHER_TINT.clear.fogNear, w.fogNear, this.intensity)
    const far = THREE.MathUtils.lerp(WEATHER_TINT.clear.fogFar, w.fogFar, this.intensity)
    this.fog.near = near
    this.fog.far = far * (1 - this.darkness * 0.35)
    this.scene.background = fogColor
  }

  private keyAt(t: number): { top: THREE.Color; horizon: THREE.Color; sun: THREE.Color; sunI: number; amb: number; fog: THREE.Color } {
    let a = SKY_KEYS[0]
    let b = SKY_KEYS[SKY_KEYS.length - 1]
    for (let i = 0; i < SKY_KEYS.length - 1; i += 1) {
      if (t >= SKY_KEYS[i].t && t <= SKY_KEYS[i + 1].t) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break }
    }
    const f = b.t === a.t ? 0 : THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1)
    const c = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), f)
    return { top: c(a.top, b.top), horizon: c(a.horizon, b.horizon), sun: c(a.sun, b.sun), sunI: THREE.MathUtils.lerp(a.sunI, b.sunI, f), amb: THREE.MathUtils.lerp(a.amb, b.amb, f), fog: c(a.fog, b.fog) }
  }

  private updatePrecip(dt: number, focus: THREE.Vector3): void {
    const w = this.conditions.weather
    const attr = this.precip.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    const fall = w === 'rain' ? 26 : w === 'snow' ? 3.2 : 1.2
    const drift = w === 'sandstorm' ? 18 : w === 'snow' ? 1.2 : 2
    const visibleCount = Math.floor(arr.length / 3 * (0.35 + 0.65 * this.intensity))
    this.precip.geometry.setDrawRange(0, visibleCount)
    for (let i = 0; i < visibleCount; i += 1) {
      const o = i * 3
      const v = this.precipVel[i]
      arr[o + 1] -= fall * v * dt
      arr[o] += drift * dt * v + (w === 'snow' ? Math.sin(this.time * 2 + i) * 0.02 : 0)
      if (w === 'sandstorm') arr[o + 1] += Math.sin(this.time * 3 + i) * 0.03
      if (arr[o + 1] < 0 || arr[o] > 40 || (w === 'sandstorm' && arr[o + 1] > 12)) {
        arr[o] = (Math.random() - 0.5) * 80 - (w === 'sandstorm' ? 20 : 0)
        arr[o + 1] = w === 'sandstorm' ? Math.random() * 10 : 30 + Math.random() * 10
        arr[o + 2] = (Math.random() - 0.5) * 80
      }
    }
    attr.needsUpdate = true
    this.precip.position.set(focus.x, 0, focus.z)
  }
}
