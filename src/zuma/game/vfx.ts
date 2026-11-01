import * as THREE from 'three'

/** Pooled soft particles for dust, mud, snow and water spray thrown up by tyres. */
export class ParticlePool {
  readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly col: Float32Array
  private readonly size: Float32Array
  private next = 0
  private readonly material: THREE.ShaderMaterial

  constructor(private readonly count = 1400) {
    this.pos = new Float32Array(count * 3)
    this.vel = new Float32Array(count * 3)
    this.life = new Float32Array(count)
    this.maxLife = new Float32Array(count).fill(1)
    this.col = new Float32Array(count * 4)
    this.size = new Float32Array(count)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4))
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1))
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute vec4 color; attribute float psize; varying vec4 vColor; void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = psize * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec4 vColor; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(vColor.rgb, vColor.a * smoothstep(0.5, 0.1, d)); }',
    })
    this.points = new THREE.Points(g, this.material)
    this.points.frustumCulled = false
  }

  emit(at: THREE.Vector3, velocity: THREE.Vector3, color: THREE.Color, life: number, size: number, alpha = 0.6): void {
    const i = this.next
    this.next = (this.next + 1) % this.count
    this.pos.set([at.x, at.y, at.z], i * 3)
    this.vel.set([velocity.x, velocity.y, velocity.z], i * 3)
    this.life[i] = life
    this.maxLife[i] = life
    this.col.set([color.r, color.g, color.b, alpha], i * 4)
    this.size[i] = size
  }

  update(dt: number, gravity = -3): void {
    for (let i = 0; i < this.count; i += 1) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue }
      this.life[i] -= dt
      const o = i * 3
      this.vel[o + 1] += gravity * dt
      const drag = Math.exp(-1.6 * dt)
      this.vel[o] *= drag; this.vel[o + 2] *= drag
      this.pos[o] += this.vel[o] * dt
      this.pos[o + 1] = Math.max(0.05, this.pos[o + 1] + this.vel[o + 1] * dt)
      this.pos[o + 2] += this.vel[o + 2] * dt
      const t = Math.max(0, this.life[i] / this.maxLife[i])
      this.size[i] *= 1 + dt * 1.4
      this.col[i * 4 + 3] = Math.min(this.col[i * 4 + 3], t * 0.7)
    }
    const g = this.points.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.color.needsUpdate = true
    g.attributes.psize.needsUpdate = true
  }

  clear(): void {
    this.next = 0
    this.life.fill(0)
    this.col.fill(0)
    this.size.fill(0)
    this.points.geometry.attributes.color.needsUpdate = true
    this.points.geometry.attributes.psize.needsUpdate = true
  }
}

/** Ring buffer of flat quads that leaves tyre marks while drifting or braking hard. */
export class SkidMarks {
  readonly mesh: THREE.InstancedMesh
  private next = 0
  private readonly dummy = new THREE.Object3D()

  constructor(private readonly count = 900, color = 0x1a1612) {
    const g = new THREE.PlaneGeometry(0.32, 0.9)
    g.rotateX(-Math.PI / 2)
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), count)
    this.mesh.frustumCulled = false
    this.clear()
  }

  setColor(color: number, opacity: number): void {
    const m = this.mesh.material as THREE.MeshBasicMaterial
    m.color.set(color)
    m.opacity = opacity
  }

  add(at: THREE.Vector3, yaw: number): void {
    this.dummy.position.set(at.x, 0.05, at.z)
    this.dummy.rotation.set(0, yaw, 0)
    this.dummy.scale.set(1, 1, 1)
    this.dummy.updateMatrix()
    this.mesh.setMatrixAt(this.next, this.dummy.matrix)
    this.next = (this.next + 1) % this.count
    this.mesh.instanceMatrix.needsUpdate = true
  }

  clear(): void {
    this.next = 0
    this.dummy.scale.set(0, 0, 0)
    this.dummy.updateMatrix()
    for (let i = 0; i < this.count; i += 1) this.mesh.setMatrixAt(i, this.dummy.matrix)
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
