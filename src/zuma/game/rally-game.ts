import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { CAMPAIGN_CARS, CAR_ABILITIES, finishStage, stageByNumber, TURBO_TYPES, type CampaignCar, type CarAbilityId, type CarId, type RaceProgress } from './campaign'
import { CONFIG } from './config'
import { RallyTrack, type TrackHazard } from './rally-track'
import { tuning } from './tuning'

export type RallyMode = 'attract' | 'countdown' | 'playing' | 'paused' | 'ended'
export type RallyResult = {
  won: boolean
  stage: number
  stageName: string
  elapsed: number
  reward: number
  coins: number
  unlockedStage: number
  nextStage: number
  unranked: boolean
}
export type RallyHud = {
  stage: number
  stageName: string
  speed: number
  lap: number
  laps: number
  place: number
  racers: number
  elapsed: number
  turbo: number
  impacts: number
  impactResetNotice: boolean
  coins: number
  crashed: boolean
  drifting: boolean
  countdown: number
  starting: boolean
}
export type RallyHooks = {
  result(result: RallyResult): void
  progress(progress: RaceProgress): void
  pause(): void
}

type Rival = {
  root: THREE.Group
  body: THREE.Group
  distance: number
  speed: number
  lane: number
  previousLane: number
  targetLane: number
  targetSpeed: number
  decisionTimer: number
  randomState: number
  swerveVelocity: number
  ability: CarAbilityId
}
type CarModelSources = Partial<Record<CarId, THREE.Object3D>>

const FORWARD = new THREE.Vector3(0, 0, 1)
const UP = new THREE.Vector3(0, 1, 0)
const RIVAL_CARS: readonly CarId[] = ['zuma-rs', 'dune-pickup', 'storm-buggy', 'falcon-rally', 'atlas-suv', 'mirage-gt']
const RIVAL_COLORS = ['#42a6b8', '#d85b43', '#e7b246', '#6f9f63', '#8f70d6', '#d17d41']

/** Three.js arcade rally controller. Gameplay state advances only from the fixed simulation step. */
export class RallyGame {
  mode: RallyMode = 'attract'
  reducedMotion = false
  stageNumber = 1
  trackDistance = 0
  laneOffset = 0
  speed = 0
  nitro = 1
  elapsed = 0
  crashTimer = 0
  impacts = 0
  private impactResetNoticeSeconds = 0
  private crashCooldown = 0
  private crashDuration = 1.05
  private crashSign = 1
  private lateralVelocity = 0
  private previousPlayerLane = 0
  private time = 0
  private driftActive = false
  private steerInput = 0
  private longitudinalAccel = 0
  private bodyPitch = 0
  private bodyYaw = 0
  private bodyRoll = 0
  private nitroEffect = 0
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200)
  private readonly vehicle = new THREE.Group()
  private body: THREE.Group
  private readonly shadow: THREE.Mesh
  private readonly rivals: Rival[] = []
  private readonly collidedHazards = new Set<string>()
  private track: RallyTrack
  private stageLaps = 2
  private car: CampaignCar
  private progress: RaceProgress
  private unranked = false
  private lastCrashSound = 0
  private countdownRemaining = 0
  private lastCountdownCue = 3
  private startSignalTime = 0
  private pausedMode: 'countdown' | 'playing' = 'playing'
  private raceRunNumber = 0

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly modelSources: THREE.Object3D | CarModelSources,
    progress: RaceProgress,
    private readonly hooks: RallyHooks,
  ) {
    this.progress = progress
    this.car = this.carFor(progress.selectedCar)
    this.scene.background = new THREE.Color(0xe7bd80)
    this.scene.fog = new THREE.Fog(0xe7bd80, 120, 460)
    const ambient = new THREE.HemisphereLight(0xfff1d2, 0x70543b, 2.1)
    this.scene.add(ambient)
    const sun = new THREE.DirectionalLight(0xffdfa9, 3.4)
    sun.position.set(-80, 130, 70)
    sun.castShadow = true
    sun.shadow.mapSize.set(renderer.shadowMapSize, renderer.shadowMapSize)
    sun.shadow.camera.left = -150
    sun.shadow.camera.right = 150
    sun.shadow.camera.top = 150
    sun.shadow.camera.bottom = -150
    sun.shadow.bias = -0.0004
    this.scene.add(sun)

    this.body = this.createVehicle(this.car, this.car.color)
    this.vehicle.add(this.body)
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 24),
      new THREE.MeshBasicMaterial({ color: 0x35291e, transparent: true, opacity: 0.27, depthWrite: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.035
    this.vehicle.add(this.shadow)
    this.scene.add(this.vehicle)

    this.track = new RallyTrack(1, CONFIG.race.trackWidth)
    this.scene.add(this.track.group)
    this.buildRivals()
    this.resetCarPose()
  }

  get currentStage() { return stageByNumber(this.stageNumber)! }
  get currentCar() { return this.car }
  get progressState() { return this.progress }

  start(stageNumber = this.progress.unlockedStage): void {
    const stage = stageByNumber(stageNumber)
    if (!stage || stageNumber > this.progress.unlockedStage) return
    tuning.activate('run')
    this.unranked = tuning.unranked
    if (this.track.stageNumber !== stageNumber) this.replaceTrack(stageNumber)
    this.stageNumber = stageNumber
    this.stageLaps = stage.difficulty >= 50 ? 3 : 2
    this.trackDistance = 0
    this.laneOffset = 0
    this.previousPlayerLane = 0
    this.lateralVelocity = 0
    this.steerInput = 0
    this.longitudinalAccel = 0
    this.bodyPitch = 0
    this.bodyYaw = 0
    this.bodyRoll = 0
    this.nitroEffect = 0
    this.body.position.set(0, 0, 0)
    this.speed = 0
    this.nitro = this.progress.selectedTurbo ? 1 : 0
    this.elapsed = 0
    this.crashTimer = 0
    this.crashCooldown = 0
    this.impacts = 0
    this.impactResetNoticeSeconds = 0
    this.collidedHazards.clear()
    this.raceRunNumber += 1
    for (const [i, rival] of this.rivals.entries()) {
      const row = Math.floor(i / 2)
      rival.distance = 10 + row * 8 + (i % 2) * 2
      rival.randomState = (Math.imul(stageNumber, 0x45d9f3b) ^ Math.imul(this.raceRunNumber, 0x9e3779b1) ^ Math.imul(i + 1, 0x27d4eb2d)) >>> 0
      const pace = 0.77 - row * 0.018 + stage.difficulty * 0.0012 + (this.nextRivalRandom(rival) - 0.5) * 0.055
      rival.targetSpeed = CONFIG.race.maxSpeed * pace * CAR_ABILITIES[rival.ability].topSpeed
      rival.speed = rival.targetSpeed
      rival.lane = i % 2 === 0 ? -3.2 : 3.2
      rival.previousLane = rival.lane
      rival.targetLane = rival.lane
      rival.swerveVelocity = 0
      rival.decisionTimer = 0.4 + this.nextRivalRandom(rival) * 1.2
    }
    this.input.endFrame()
    this.countdownRemaining = 3
    this.lastCountdownCue = 3
    this.startSignalTime = 0
    this.pausedMode = 'playing'
    this.mode = 'countdown'
    this.audio.unlock()
    this.audio.play('countdown')
    this.resetCarPose()
  }

  pause(): void {
    if (this.mode === 'playing' || this.mode === 'countdown') {
      this.pausedMode = this.mode
      this.mode = 'paused'
    }
  }

  resume(): void {
    if (this.mode !== 'paused') return
    this.input.endFrame()
    this.mode = this.pausedMode
  }

  toTitle(): void {
    this.mode = 'attract'
    this.countdownRemaining = 0
    this.startSignalTime = 0
    this.speed = 0
    this.crashTimer = 0
    this.nitroEffect = 0
    this.bodyPitch = 0
    this.bodyYaw = 0
    this.bodyRoll = 0
    this.resetCarPose()
  }

  setQuality(quality: 'low' | 'medium' | 'high'): void {
    this.renderer.applyQuality(quality)
  }

  resize(width: number, height: number): void {
    this.camera.aspect = Math.max(1, width) / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  setProgress(progress: RaceProgress): void {
    const turboWasLocked = this.progress.selectedTurbo === null
    this.progress = progress
    if (turboWasLocked && progress.selectedTurbo !== null) this.nitro = 1
    this.car = this.carFor(progress.selectedCar)
    this.vehicle.remove(this.body)
    this.disposeVehicle(this.body)
    this.body = this.createVehicle(this.car, this.car.color)
    this.vehicle.add(this.body)
  }

  step(dt: number): void {
    if (this.mode === 'countdown') {
      this.impactResetNoticeSeconds = Math.max(0, this.impactResetNoticeSeconds - dt)
      this.countdownRemaining = Math.max(0, this.countdownRemaining - dt)
      const remaining = Math.ceil(this.countdownRemaining)
      if (remaining > 0 && remaining < this.lastCountdownCue) {
        this.lastCountdownCue = remaining
        this.audio.play('countdown')
      }
      if (this.countdownRemaining === 0) {
        this.mode = 'playing'
        this.startSignalTime = 0.75
        this.audio.play('start')
        this.audio.startMusic()
      }
      return
    }
    if (this.mode !== 'playing') return
    this.startSignalTime = Math.max(0, this.startSignalTime - dt)
    this.elapsed += dt
    this.crashCooldown = Math.max(0, this.crashCooldown - dt)
    const previousSpeed = this.speed
    const manualThrottle = Math.max(0, this.input.move.y, this.input.held('throttle') ? 1 : 0)
    const reverse = Math.max(0, -this.input.move.y)
    const brake = this.input.held('brake') || reverse > 0
    const turboType = TURBO_TYPES.find(item => item.id === this.progress.selectedTurbo)
    const turboHeld = this.input.held('turbo') && !!turboType && this.nitro > 0.01 && !this.crashTimer
    const drift = (this.input.held('drift') || brake) && this.speed > 7
    this.driftActive = drift
    this.nitroEffect = turboHeld ? Math.min(1, this.nitroEffect + dt * 3.8) : Math.max(0, this.nitroEffect - dt * 2.6)

    const ability = CAR_ABILITIES[this.car.ability]
    const engineScale = (0.82 + this.car.acceleration * 0.035 + this.progress.engineUpgrade * 0.035) * ability.acceleration
    const speedScale = (0.82 + this.car.topSpeed * 0.036 + this.progress.engineUpgrade * 0.035) * ability.topSpeed
    const maxSpeed = CONFIG.race.maxSpeed * speedScale
    const acceleration = CONFIG.race.acceleration * engineScale
    if (this.crashTimer > 0) {
      this.crashTimer = Math.max(0, this.crashTimer - dt)
      this.speed = Math.max(4, this.speed - 11 * dt)
      if (this.crashTimer === 0) this.lateralVelocity *= -0.28
    } else if (brake) {
      const brakePower = this.input.held('brake') ? 1 : reverse
      if (this.speed > 0.8) this.speed = Math.max(0, this.speed - CONFIG.race.brakeForce * brakePower * dt)
      else this.speed = Math.max(-6, this.speed - CONFIG.race.reverseForce * Math.max(brakePower, 0.6) * dt)
    } else if (manualThrottle > 0) {
      this.speed = Math.min(maxSpeed, this.speed + acceleration * manualThrottle * dt)
    } else if (this.speed < CONFIG.race.autoCruiseSpeed) {
      this.speed = Math.min(CONFIG.race.autoCruiseSpeed, this.speed + acceleration * CONFIG.race.autoThrottle * dt)
    } else if (this.speed > CONFIG.race.autoCruiseSpeed) {
      this.speed = Math.max(CONFIG.race.autoCruiseSpeed, this.speed - CONFIG.race.coastDrag * dt)
    }

    if (turboHeld && turboType) {
      this.speed = Math.min(maxSpeed * turboType.topSpeed, this.speed + CONFIG.race.nitroForce * turboType.power * ability.turboPower * dt)
      this.nitro = Math.max(0, this.nitro - dt * turboType.drain)
    } else if (turboType) {
      this.nitro = Math.min(1, this.nitro + dt * turboType.recharge * ability.turboRecharge)
    } else {
      this.nitro = 0
    }

    const tireScale = (0.8 + this.car.grip * 0.04 + this.progress.tireUpgrade * 0.075) * ability.grip
    const steer = -this.input.move.x * this.input.sensitivity
    const lateralAccel = CONFIG.race.steeringForce * tireScale * ability.steering * (drift ? 1.24 * ability.drift : 1) * Math.min(1.4, 0.58 + Math.abs(this.speed) / 23)
    this.previousPlayerLane = this.laneOffset
    this.lateralVelocity += steer * lateralAccel * dt
    this.lateralVelocity *= Math.exp(-(drift ? 1.5 : 3.25) * dt)
    this.laneOffset += this.lateralVelocity * dt
    this.steerInput = steer
    if (Math.abs(steer) < 0.03 && !drift) this.laneOffset *= Math.exp(-0.16 * dt)

    if (Math.abs(this.laneOffset) > this.track.width * 0.5 - 1.2 && this.speed > CONFIG.race.crashSpeed && this.crashCooldown <= 0) {
      this.triggerCrash(Math.sign(this.laneOffset) || 1)
      this.laneOffset = THREE.MathUtils.clamp(this.laneOffset, -this.track.width * 0.5 + 1.25, this.track.width * 0.5 - 1.25)
      this.lateralVelocity = -Math.sign(this.laneOffset) * 3.5
    }
    if (Math.abs(this.laneOffset) > this.track.width * 0.35) this.speed = Math.max(0, this.speed - 5.2 * ability.offroadDrag * dt)
    this.longitudinalAccel = (this.speed - previousSpeed) / Math.max(0.001, dt)

    if (this.crashTimer <= 0) this.trackDistance = Math.max(0, this.trackDistance + this.speed * dt)
    this.updateRivals(dt)
    if (this.mode !== 'playing') return
    this.checkHazards()
    this.checkRivalCollision()
    if (this.elapsed >= this.currentStage.timeLimitSeconds) {
      this.finish(false)
      return
    }
    const finishDistance = this.track.length * this.stageLaps
    if (this.trackDistance >= finishDistance) {
      this.finish(this.rivals.every(rival => rival.distance < finishDistance))
      return
    }
    if (this.rivals.some(rival => rival.distance >= finishDistance)) this.finish(false)
  }

  render(_alpha: number, frameSeconds: number): void {
    this.time += frameSeconds
    const targetFov = CONFIG.camera.fov + (this.reducedMotion ? 0 : this.nitroEffect * 4.5)
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov
      this.camera.updateProjectionMatrix()
    }
    const sample = this.track.sample(this.trackDistance, this.laneOffset)
    this.vehicle.position.copy(sample.position).setY(0.16 + (this.crashTimer > 0 ? Math.sin((0.9 - this.crashTimer) * Math.PI * 2) * 0.45 + 0.55 : 0))
    const slipAngle = THREE.MathUtils.clamp(Math.atan2(this.lateralVelocity, Math.max(4, Math.abs(this.speed))), -0.28, 0.28)
    const heading = sample.tangent.clone().applyAxisAngle(UP, slipAngle)
    this.vehicle.quaternion.setFromUnitVectors(FORWARD, heading)
    if (this.crashTimer > 0) {
      this.body.position.y = 0
      this.body.rotation.set(0, this.bodyYaw, this.rollAngle())
    } else {
      const dt = Math.max(0, frameSeconds)
      const activeDrive = this.mode === 'playing' && !this.reducedMotion
      const targetPitch = activeDrive ? THREE.MathUtils.clamp(-this.longitudinalAccel * 0.004, -0.08, 0.08) : 0
      const lateralRatio = this.lateralVelocity / Math.max(8, Math.abs(this.speed))
      const targetRoll = activeDrive ? THREE.MathUtils.clamp(-this.steerInput * 0.035 - lateralRatio * 0.06, -0.1, 0.1) : 0
      const targetYaw = activeDrive ? THREE.MathUtils.clamp(this.steerInput * 0.045 + Math.atan2(this.lateralVelocity, Math.max(8, Math.abs(this.speed))) * 0.16, -0.12, 0.12) : 0
      this.bodyPitch = THREE.MathUtils.damp(this.bodyPitch, targetPitch, 8, dt)
      this.bodyYaw = THREE.MathUtils.damp(this.bodyYaw, targetYaw, 8, dt)
      this.bodyRoll = THREE.MathUtils.damp(this.bodyRoll, targetRoll, 8, dt)
      this.body.position.y = this.reducedMotion ? 0 : Math.sin(this.time * 8 + this.trackDistance * 0.25) * Math.min(0.018, Math.abs(this.speed) * 0.0006)
      this.body.rotation.set(this.bodyPitch, this.bodyYaw, this.bodyRoll)
    }
    this.updateVehicleEffects(this.body, this.speed, this.lateralVelocity, this.nitroEffect, this.driftActive, frameSeconds)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = this.crashTimer > 0 ? 0.12 : 0.27
    this.shadow.scale.setScalar(this.crashTimer > 0 ? 0.82 : 1)

    for (const rival of this.rivals) {
      this.placeCar(rival.root, this.track.sample(rival.distance, rival.lane))
      this.updateVehicleEffects(rival.body, rival.speed, 0, 0, false, frameSeconds)
    }
    if (this.mode === 'attract' || this.mode === 'ended') {
      const orbit = this.time * 0.065
      const center = this.track.sample(0).position
      this.camera.position.set(center.x + Math.sin(orbit) * 28, 13 + Math.sin(this.time * 0.18) * 1.1, center.z + Math.cos(orbit) * 35)
      this.camera.lookAt(center.x + sample.tangent.x * 6, 2.4, center.z + sample.tangent.z * 6)
    } else {
      const back = sample.position.clone().addScaledVector(sample.tangent, -(CONFIG.camera.distance + 4))
      const desired = back.add(new THREE.Vector3(0, CONFIG.camera.height + 3, 0))
      if (!this.camera.userData.ready) {
        this.camera.position.copy(desired)
        this.camera.userData.ready = true
      } else this.camera.position.lerp(desired, 1 - Math.exp(-CONFIG.camera.follow * frameSeconds))
      const target = sample.position.clone().addScaledVector(sample.tangent, 5).add(new THREE.Vector3(0, 1.7, 0))
      this.camera.lookAt(target)
      if (!this.reducedMotion && this.mode === 'playing') this.camera.rotateZ(this.steerInput * 0.014 + (this.driftActive ? Math.sign(this.lateralVelocity) * 0.01 : 0))
      if (!this.reducedMotion && this.crashTimer > 0) {
        const shake = this.crashTimer * 0.28
        this.camera.position.x += Math.sin(this.time * 42) * shake
        this.camera.position.y += Math.cos(this.time * 37) * shake * 0.5
      }
    }
    this.renderer.render(this.scene, this.camera)
  }

  hud(): RallyHud {
    const lap = Math.min(this.stageLaps, Math.floor(this.trackDistance / this.track.length) + 1)
    const ahead = this.rivals.filter(rival => rival.distance > this.trackDistance).length
    return {
      stage: this.stageNumber,
      stageName: this.currentStage.name,
      speed: Math.round(Math.max(0, this.speed) * 3.6),
      lap,
      laps: this.stageLaps,
      place: 1 + ahead,
      racers: 1 + this.rivals.length,
      elapsed: this.elapsed,
      turbo: this.nitro,
      impacts: this.impacts,
      impactResetNotice: this.impactResetNoticeSeconds > 0,
      coins: this.progress.coins,
      crashed: this.crashTimer > 0,
      drifting: this.driftActive,
      countdown: this.mode === 'countdown' ? Math.max(1, Math.ceil(this.countdownRemaining)) : 0,
      starting: this.startSignalTime > 0,
    }
  }

  /** Useful for the in-project smoke test: it exercises the same crash/rollover transition as a collision. */
  forceCrashForTest(): void { this.triggerCrash(1) }

  private carFor(id: CarId): CampaignCar {
    return CAMPAIGN_CARS.find(car => car.id === id) ?? CAMPAIGN_CARS[0]
  }

  private disposeVehicle(body: THREE.Group): void {
    const disposeGeometry = body.userData.procedural === true
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    body.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      if (disposeGeometry || mesh.name === 'zuma-nitro-flame' || mesh.name === 'zuma-sand-puff') geometries.add(mesh.geometry)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
    })
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => material.dispose())
  }

  private createVehicle(car: CampaignCar, color: string): THREE.Group {
    const wrapper = new THREE.Group()
    const singleSource = (this.modelSources as THREE.Object3D).isObject3D
    const sources: CarModelSources = singleSource
      ? { 'dune-runner': this.modelSources as THREE.Object3D }
      : this.modelSources as CarModelSources
    const dedicatedSource = sources[car.id]
    if (!dedicatedSource && car.id !== 'dune-runner') {
      const model = this.createProceduralVehicle(car)
      wrapper.userData.procedural = true
      wrapper.userData.wheels = model.userData.wheels
      wrapper.userData.frontAxles = model.userData.frontAxles
      wrapper.add(model)
      this.addVehicleEffects(wrapper)
      return wrapper
    }
    const source = dedicatedSource ?? sources['dune-runner']
    if (!source) throw new Error('Zuma Race requires a base rally car model.')
    const model = source.clone(true)
    const rawBounds = new THREE.Box3().setFromObject(model)
    const rawSize = rawBounds.getSize(new THREE.Vector3())
    // Generated car models commonly face +X; detect their long axis and turn the nose toward track +Z.
    if (rawSize.x > rawSize.z * 1.15) model.rotation.y = -Math.PI / 2
    model.updateMatrixWorld(true)
    model.traverse(child => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone()
    })
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    const scale = 4.35 / Math.max(size.z, size.x, 0.01)
    model.scale.setScalar(scale)
    model.position.set(
      -(bounds.min.x + bounds.max.x) * 0.5 * scale,
      -bounds.min.y * scale,
      -(bounds.min.z + bounds.max.z) * 0.5 * scale,
    )
    wrapper.add(model)
    if (!dedicatedSource || car.id === 'dune-runner') tintVehicle(wrapper, color)
    this.addVehicleEffects(wrapper)
    return wrapper
  }

  private createProceduralVehicle(car: CampaignCar): THREE.Group {
    const vehicle = new THREE.Group()
    const design = car.design
    const buggy = design === 'buggy'
    const truck = design === 'rally-truck' || design === 'pickup'
    const suv = design === 'suv' || design === '4x4'
    const width = suv || truck ? 2.02 : buggy ? 1.9 : 1.82
    const length = truck ? 4.65 : suv ? 4.35 : buggy ? 3.85 : 4.1
    const paint = new THREE.MeshStandardMaterial({ color: car.color, roughness: 0.38, metalness: 0.26 })
    const trim = new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.74, metalness: 0.12 })
    const glass = new THREE.MeshStandardMaterial({ color: 0x253c4b, roughness: 0.24, metalness: 0.16, transparent: true, opacity: 0.62 })
    const tire = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.94 })
    const alloy = new THREE.MeshStandardMaterial({ color: 0xaeb5b9, roughness: 0.33, metalness: 0.78 })
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffedb0, emissive: 0xffbd4d, emissiveIntensity: 0.28, roughness: 0.3 })
    const tail = new THREE.MeshStandardMaterial({ color: 0x8c261f, emissive: 0x8f1c12, emissiveIntensity: 0.34 })
    const addBox = (name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
      mesh.name = name
      mesh.position.set(...position)
      mesh.castShadow = true
      mesh.receiveShadow = true
      vehicle.add(mesh)
      return mesh
    }

    addBox('chassis', [width, 0.32, length * 0.84], [0, 0.69, 0], trim)
    addBox('painted-body', [width * 0.93, 0.48, length * 0.72], [0, 0.86, -0.02], paint)
    addBox('hood', [width * 0.82, 0.22, length * 0.28], [0, 1.13, length * 0.24], paint)
    addBox('front-bumper', [width * 1.02, 0.16, 0.18], [0, 0.64, length * 0.46], trim)
    addBox('rear-bumper', [width * 1.02, 0.15, 0.18], [0, 0.63, -length * 0.46], trim)
    addBox('grille', [width * 0.33, 0.18, 0.045], [0, 0.91, length * 0.49], trim)

    if (truck) {
      addBox('cab', [width * 0.78, 0.65, length * 0.37], [0, 1.27, -length * 0.04], paint)
      addBox('windshield', [width * 0.65, 0.38, 0.045], [0, 1.34, length * 0.17], glass)
      addBox('cargo-bed', [width * 0.77, 0.2, length * 0.29], [0, 1.12, -length * 0.31], trim)
      for (const x of [-1, 1]) addBox(`bed-rail-${x}`, [0.08, 0.28, length * 0.3], [x * width * 0.34, 1.31, -length * 0.31], paint)
    } else if (buggy) {
      addBox('cockpit', [width * 0.65, 0.14, length * 0.32], [0, 1.12, -0.02], trim)
      for (const x of [-1, 1]) {
        addBox(`roll-cage-side-${x}`, [0.075, 0.85, 0.075], [x * width * 0.31, 1.49, -0.02], alloy)
        addBox(`roll-cage-cross-${x}`, [0.075, 0.075, length * 0.43], [x * width * 0.31, 1.88, -0.02], alloy)
      }
      addBox('roll-cage-front', [width * 0.62, 0.075, 0.075], [0, 1.88, length * 0.19], alloy)
      addBox('roll-cage-rear', [width * 0.62, 0.075, 0.075], [0, 1.88, -length * 0.22], alloy)
    } else {
      addBox('roof', [width * 0.72, 0.16, length * 0.33], [0, 1.68, -length * 0.03], paint)
      addBox('windshield', [width * 0.65, 0.4, 0.045], [0, 1.42, length * 0.15], glass)
      addBox('rear-window', [width * 0.61, 0.32, 0.045], [0, 1.4, -length * 0.23], glass)
      if (suv) {
        addBox('roof-rack-left', [0.08, 0.08, length * 0.29], [-width * 0.31, 1.82, -0.03], alloy)
        addBox('roof-rack-right', [0.08, 0.08, length * 0.29], [width * 0.31, 1.82, -0.03], alloy)
      }
    }

    for (const x of [-1, 1]) {
      addBox(`headlight-${x}`, [0.28, 0.13, 0.06], [x * width * 0.3, 1.02, length * 0.475], lamp)
      addBox(`taillight-${x}`, [0.2, 0.15, 0.06], [x * width * 0.34, 0.98, -length * 0.455], tail)
      addBox(`mirror-${x}`, [0.13, 0.09, 0.22], [x * width * 0.47, 1.28, length * 0.13], trim)
    }

    const wheels: THREE.Mesh[] = []
    const frontAxles: THREE.Group[] = []
    const tireGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16)
    tireGeometry.rotateZ(Math.PI / 2)
    const hubGeometry = new THREE.CylinderGeometry(0.19, 0.19, 0.315, 12)
    hubGeometry.rotateZ(Math.PI / 2)
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const axle = new THREE.Group()
        axle.position.set(x * (width * 0.5 + 0.03), 0.43, z * length * 0.32)
        const wheel = new THREE.Mesh(tireGeometry, tire)
        wheel.name = `wheel-${z > 0 ? 'front' : 'rear'}-${x}`
        wheel.castShadow = true
        const hub = new THREE.Mesh(hubGeometry, alloy)
        hub.name = `hub-${x}-${z}`
        axle.add(wheel, hub)
        vehicle.add(axle)
        wheels.push(wheel)
        if (z > 0) frontAxles.push(axle)
      }
    }

    const driver = new THREE.Group()
    const suit = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.26), trim)
    suit.position.y = 1.22
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf2bd4b, roughness: 0.32, metalness: 0.18 }))
    helmet.position.set(0, 1.51, 0.12)
    driver.add(suit, helmet)
    vehicle.add(driver)
    vehicle.userData.wheels = wheels
    vehicle.userData.frontAxles = frontAxles
    return vehicle
  }

  private addVehicleEffects(wrapper: THREE.Group): void {
    const nitro = new THREE.Mesh(
      new THREE.ConeGeometry(0.19, 0.9, 7),
      new THREE.MeshBasicMaterial({ color: 0x8feaff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    nitro.name = 'zuma-nitro-flame'
    nitro.rotation.x = -Math.PI / 2
    nitro.position.set(0, 0.48, -2.05)
    nitro.visible = false
    wrapper.add(nitro)
    wrapper.userData.nitroFlame = nitro
    const sandPuffs = [-0.58, 0.58].map(x => {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xd8b47e, transparent: true, opacity: 0, depthWrite: false }),
      )
      puff.name = 'zuma-sand-puff'
      puff.position.set(x, 0.15, -1.78)
      puff.scale.set(0.68, 0.22, 0.8)
      wrapper.add(puff)
      return puff
    })
    wrapper.userData.sandPuffs = sandPuffs
  }

  private updateVehicleEffects(body: THREE.Group, speed: number, lateral: number, nitro: number, drifting: boolean, dt: number): void {
    const wheels = body.userData.wheels as THREE.Mesh[] | undefined
    wheels?.forEach(wheel => { wheel.rotation.x += (speed * dt) / 0.42 })
    const frontAxles = body.userData.frontAxles as THREE.Group[] | undefined
    const steering = body === this.body ? this.steerInput : 0
    frontAxles?.forEach(axle => { axle.rotation.y = THREE.MathUtils.clamp(steering * 0.15, -0.24, 0.24) })
    const flame = body.userData.nitroFlame as THREE.Mesh | undefined
    if (flame) {
      flame.visible = nitro > 0.02
      flame.scale.set(0.65 + nitro * 0.4, 0.55 + nitro * (0.9 + Math.sin(this.time * 38) * 0.12), 0.65 + nitro * 0.4)
      ;(flame.material as THREE.MeshBasicMaterial).opacity = nitro * 0.85
    }
    const dustLevel = THREE.MathUtils.clamp(Math.abs(speed) / CONFIG.race.maxSpeed * 0.24 + Math.min(0.16, Math.abs(lateral) * 0.018) + (drifting ? 0.16 : 0), 0, 0.52)
    const sandPuffs = body.userData.sandPuffs as THREE.Mesh[] | undefined
    sandPuffs?.forEach((puff, index) => {
      puff.visible = dustLevel > 0.025
      puff.scale.set(0.55 + dustLevel, 0.22 + dustLevel * 0.3, 0.7 + dustLevel * 1.6)
      ;(puff.material as THREE.MeshBasicMaterial).opacity = dustLevel * (index === 0 ? 0.62 : 0.82)
    })
  }

  private buildRivals(): void {
    for (let i = 0; i < RIVAL_CARS.length; i += 1) {
      const root = new THREE.Group()
      const car = this.carFor(RIVAL_CARS[i])
      const body = this.createVehicle(car, RIVAL_COLORS[i])
      root.add(body)
      this.scene.add(root)
      const lane = i % 2 === 0 ? -3.2 : 3.2
      this.rivals.push({ root, body, distance: 0, speed: 0, lane, previousLane: lane, targetLane: lane, targetSpeed: 0, decisionTimer: 0, randomState: i + 1, swerveVelocity: 0, ability: car.ability })
    }
  }

  private replaceTrack(stageNumber: number): void {
    this.scene.remove(this.track.group)
    this.track.dispose()
    this.track = new RallyTrack(stageNumber, CONFIG.race.trackWidth + Math.min(2, Math.floor(stageNumber / 40)))
    this.scene.add(this.track.group)
    this.camera.userData.ready = false
  }

  private resetCarPose(): void {
    const sample = this.track.sample(this.trackDistance, this.laneOffset)
    this.vehicle.position.copy(sample.position).setY(0.16)
    this.vehicle.quaternion.setFromUnitVectors(FORWARD, sample.tangent)
    this.body.rotation.set(0, 0, 0)
    for (const rival of this.rivals) this.placeCar(rival.root, this.track.sample(rival.distance, rival.lane))
    this.camera.userData.ready = false
  }

  private placeCar(root: THREE.Group, sample: { position: THREE.Vector3; tangent: THREE.Vector3 }): void {
    root.position.copy(sample.position).setY(0.16)
    root.quaternion.setFromUnitVectors(FORWARD, sample.tangent)
  }

  private nextRivalRandom(rival: Rival): number {
    rival.randomState = (Math.imul(rival.randomState, 1_664_525) + 1_013_904_223) >>> 0
    return rival.randomState / 0x1_0000_0000
  }

  private updateRivals(dt: number): void {
    if (this.mode !== 'playing') return
    const laneLimit = this.track.width * 0.5 - 2.2
    for (const rival of this.rivals) {
      rival.previousLane = rival.lane
      rival.decisionTimer -= dt
      if (rival.decisionTimer <= 0) {
        const laneRoll = this.nextRivalRandom(rival)
        rival.targetLane = laneRoll < 0.17
          ? (this.nextRivalRandom(rival) < 0.5 ? -1 : 1) * laneLimit * 0.82
          : (this.nextRivalRandom(rival) * 2 - 1) * laneLimit * 0.8
        const pace = 0.73 + this.stageNumber * 0.0017 + (this.nextRivalRandom(rival) - 0.5) * 0.11
        rival.targetSpeed = CONFIG.race.maxSpeed * pace * CAR_ABILITIES[rival.ability].topSpeed
        rival.decisionTimer = 0.85 + this.nextRivalRandom(rival) * 1.75
      }
      const ability = CAR_ABILITIES[rival.ability]
      rival.lane += (rival.targetLane - rival.lane) * (1 - Math.exp(-1.25 * ability.steering * dt))
      rival.lane += rival.swerveVelocity * dt
      rival.swerveVelocity *= Math.exp(-2.4 * dt)
      rival.lane = THREE.MathUtils.clamp(rival.lane, -laneLimit - 0.45, laneLimit + 0.45)
      rival.speed += (rival.targetSpeed - rival.speed) * (1 - Math.exp(-0.7 * dt))
      rival.distance += rival.speed * dt
    }
  }

  private checkHazards(): void {
    if (this.speed < CONFIG.race.crashSpeed || this.crashCooldown > 0 || this.crashTimer > 0) return
    const progress = ((this.trackDistance % this.track.length) + this.track.length) % this.track.length
    this.track.hazards.forEach((hazard: TrackHazard, index) => {
      const delta = Math.abs(progress - hazard.distance)
      const wrappedDelta = Math.min(delta, this.track.length - delta)
      const lap = Math.floor(this.trackDistance / this.track.length)
      const key = `${lap}:${index}`
      if (wrappedDelta < 1.7 && Math.abs(this.laneOffset - hazard.lateral) < 1.45 && !this.collidedHazards.has(key)) {
        this.collidedHazards.add(key)
        this.triggerCrash(this.laneOffset >= hazard.lateral ? 1 : -1)
      }
    })
  }

  private checkRivalCollision(): void {
    if (this.crashTimer > 0 || this.crashCooldown > 0 || this.speed < CONFIG.race.crashSpeed) return
    const player = this.track.sample(this.trackDistance, this.laneOffset).position
    for (const rival of this.rivals) {
      const other = this.track.sample(rival.distance, rival.lane).position
      if (player.distanceToSquared(other) >= 7.8) continue
      const playerBehind = this.trackDistance <= rival.distance
      const closingSpeed = playerBehind ? this.speed - rival.speed : rival.speed - this.speed
      const previousLaneGap = Math.abs(this.previousPlayerLane - rival.previousLane)
      const playerLaneApproach = previousLaneGap - Math.abs(this.laneOffset - rival.previousLane)
      const rivalLaneApproach = previousLaneGap - Math.abs(rival.lane - this.previousPlayerLane)
      const playerMovedIntoLane = playerLaneApproach > 0.035
      const rivalMovedIntoLane = rivalLaneApproach > 0.035
      const playerAtFault = playerMovedIntoLane !== rivalMovedIntoLane
        ? playerMovedIntoLane
        : playerMovedIntoLane && Math.abs(playerLaneApproach - rivalLaneApproach) > 0.035
          ? playerLaneApproach > rivalLaneApproach
          : playerBehind ? closingSpeed >= 0 : closingSpeed < 0
      const separation = this.laneOffset - rival.lane
      const awayFromRival = separation === 0 ? (rival.lane >= 0 ? -1 : 1) : Math.sign(separation)
      if (playerAtFault) {
        this.lateralVelocity += awayFromRival * 3.2
        this.laneOffset = THREE.MathUtils.clamp(this.laneOffset + awayFromRival * 0.28, -this.track.width * 0.5 + 1, this.track.width * 0.5 - 1)
        const retention = THREE.MathUtils.clamp(0.82 + (CAR_ABILITIES[this.car.ability].crashSpeedRetention - 0.42) * 0.35, 0.75, 0.95)
        this.speed *= retention
      } else {
        rival.swerveVelocity -= awayFromRival * 3.8
        rival.targetLane = THREE.MathUtils.clamp(rival.lane - awayFromRival * 1.6, -this.track.width * 0.5 + 1.3, this.track.width * 0.5 - 1.3)
        const retention = THREE.MathUtils.clamp(0.82 + (CAR_ABILITIES[rival.ability].crashSpeedRetention - 0.42) * 0.35, 0.75, 0.95)
        rival.speed *= retention
        rival.targetSpeed = Math.min(rival.targetSpeed, rival.speed)
      }
      this.crashCooldown = 1.3
      this.impacts += 1
      if (this.time - this.lastCrashSound > 0.35) {
        this.audio.play('hurt')
        this.lastCrashSound = this.time
      }
      if (this.impacts >= 5) {
        const stage = this.stageNumber
        this.start(stage)
        this.impactResetNoticeSeconds = 3.8
      }
      return
    }
  }

  /** In-project test hook for collision fault, lateral recovery and five-hit restart rules. */
  forceRivalCollisionForTest(index = 0, playerAtFault = true, laneCutIn?: 'player' | 'rival'): void {
    const rival = this.rivals[index]
    if (!rival) return
    this.mode = 'playing'
    this.crashTimer = 0
    this.crashCooldown = 0
    this.laneOffset = rival.lane
    this.previousPlayerLane = rival.lane
    rival.previousLane = rival.lane
    if (playerAtFault) {
      this.trackDistance = rival.distance - 0.2
      rival.speed = CONFIG.race.maxSpeed * 0.62
      this.speed = rival.speed + 2.5
    } else {
      this.trackDistance = rival.distance + 0.2
      this.speed = CONFIG.race.maxSpeed * 0.62
      rival.speed = this.speed + 2.5
    }
    if (laneCutIn === 'player') this.previousPlayerLane = rival.lane + 3
    if (laneCutIn === 'rival') rival.previousLane = rival.lane + 3
    this.checkRivalCollision()
  }

  private triggerCrash(sign: number): void {
    if (this.crashCooldown > 0 || this.crashTimer > 0) return
    const ability = CAR_ABILITIES[this.car.ability]
    this.crashSign = sign >= 0 ? 1 : -1
    this.crashDuration = 1.05 * ability.crashDuration
    this.crashTimer = this.crashDuration
    this.crashCooldown = 2.15
    this.speed *= ability.crashSpeedRetention
    if (this.time - this.lastCrashSound > 0.35) {
      this.audio.play('hurt')
      this.lastCrashSound = this.time
    }
  }

  private rollAngle(): number {
    if (this.crashTimer <= 0) return 0
    const t = 1 - this.crashTimer / this.crashDuration
    if (t < 0.45) return this.crashSign * Math.PI * (t / 0.45)
    if (t < 0.62) return this.crashSign * Math.PI
    return this.crashSign * Math.PI * (1 + (t - 0.62) / 0.38)
  }

  private finish(won: boolean): void {
    if (this.mode !== 'playing') return
    this.mode = 'ended'
    this.nitroEffect = 0
    let reward = 0
    if (won && !this.unranked) {
      const result = finishStage(this.progress, this.stageNumber)
      if (result.ok) {
        reward = result.reward
        this.progress = result.progress
        this.hooks.progress(this.progress)
      }
    }
    this.audio.play(won ? 'win' : 'lose')
    this.hooks.result({
      won,
      stage: this.stageNumber,
      stageName: this.currentStage.name,
      elapsed: this.elapsed,
      reward,
      coins: this.progress.coins,
      unlockedStage: this.progress.unlockedStage,
      nextStage: Math.min(100, this.stageNumber + 1),
      unranked: this.unranked,
    })
  }
}

function tintVehicle(root: THREE.Group, color: string): void {
  const tint = new THREE.Color(color)
  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const paint = material as THREE.Material & { color?: THREE.Color }
      if (!paint.color || /wheel|tire|rubber|glass|window|lamp|light/i.test(`${mesh.name} ${material.name}`)) continue
      paint.color.copy(tint)
      paint.needsUpdate = true
    }
  })
}
