import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { CAMPAIGN_CARS, CAR_ABILITIES, finishStage, stageByNumber, TURBO_TYPES, type CampaignCar, type CarAbilityId, type CarId, type RaceProgress } from './campaign'
import { CONFIG } from './config'
import { RallyTrack, type TrackHazard } from './rally-track'
import { tuning } from './tuning'
import { Atmosphere } from './atmosphere'
import { conditionsForStage, gripForConditions, SURFACE_DRAG, TIME_LABEL, WEATHER_LABEL, type StageConditions } from './environment'
import { buildRealisticCar } from './vehicle'
import { DEFAULT_LOOK, lookFor, type CarLook, type Garage } from './customization'
import { driverById, RIVAL_DRIVERS, type Driver, type DriverId } from './characters'
import { ParticlePool, SkidMarks } from './vfx'
import { describeNote, paceNotePhase } from './pace-notes'
import { advanceLateralMotion, passingLane } from './handling'
import type { CameraMode } from '../engine/save'

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
  coDriver: string
  coDriverUrgent: boolean
  conditions: string
  camera: CameraMode
  standings: { name: string; player: boolean }[]
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
  name: string
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
  cameraMode: CameraMode = 'chase'
  private garage: Garage = {}
  private driver: Driver = driverById('salem')
  private readonly atmosphere: Atmosphere
  private conditions: StageConditions = conditionsForStage(1)
  private readonly particles = new ParticlePool(1600)
  private readonly skids = new SkidMarks(1000)
  private readonly headlight = new THREE.SpotLight(0xfff1d0, 0, 90, 0.55, 0.45, 1.2)
  private readonly heading = new THREE.Vector3(0, 0, 1)
  private coDriverText = ''
  private coDriverTimer = 0
  private coDriverUrgent = false
  private readonly announced = new Set<string>()
  private lastLapAnnounced = 0
  private lastSkidDistance = 0
  private braking = false
  private readonly tmpV = new THREE.Vector3()
  private readonly tmpV2 = new THREE.Vector3()
  private readonly tmpC = new THREE.Color()

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
    this.camera.far = 3200
    this.camera.updateProjectionMatrix()
    this.atmosphere = new Atmosphere(this.scene, renderer.shadowMapSize)
    this.scene.add(this.particles.points, this.skids.mesh)
    this.headlight.position.set(0, 1.1, 2.2)
    this.headlight.target.position.set(0, 0, 22)
    this.vehicle.add(this.headlight, this.headlight.target)

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
    this.applyConditions(1)
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
    this.applyConditions(stageNumber)
    this.announced.clear()
    this.lastLapAnnounced = 1
    this.coDriverText = ''
    this.coDriverTimer = 0
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

  /** Apply garage cosmetics and rebuild the player's car. */
  setGarage(garage: Garage): void {
    this.garage = garage
    this.setProgress(this.progress)
  }

  setDriver(id: DriverId): void { this.driver = driverById(id) }

  /** Show a stage's landscape and conditions behind the title screen. */
  preview(stageNumber: number): void {
    if (this.mode !== 'attract') return
    if (this.track.stageNumber !== stageNumber) this.replaceTrack(stageNumber)
    this.stageNumber = stageNumber
    this.trackDistance = 0
    this.laneOffset = 0
    this.applyConditions(stageNumber)
    this.resetCarPose()
  }

  get stageConditions(): StageConditions { return this.conditions }

  cycleCamera(): CameraMode {
    const modes: CameraMode[] = ['chase', 'far', 'hood', 'bumper', 'tv']
    this.cameraMode = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length]
    this.camera.userData.ready = false
    return this.cameraMode
  }

  private applyConditions(stageNumber: number): void {
    this.conditions = conditionsForStage(stageNumber)
    this.atmosphere.setConditions(this.conditions)
    this.track.setWetness(this.atmosphere.wetness)
    const surface = this.conditions.biome.surface
    const mark = surface === 'tarmac' ? 0x111214 : new THREE.Color(this.conditions.biome.road).multiplyScalar(0.55).getHex()
    this.skids.setColor(mark, surface === 'tarmac' ? 0.5 : 0.38)
    this.skids.clear()
    this.particles.clear()
  }

  step(dt: number): void {
    if (this.mode === 'countdown') {
      this.audio.updateEngine(0, 0, false, false)
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
    if (this.mode !== 'playing') { this.audio.updateEngine(0, 0, false, false); return }
    this.coDriverTimer = Math.max(0, this.coDriverTimer - dt)
    this.startSignalTime = Math.max(0, this.startSignalTime - dt)
    this.elapsed += dt
    this.crashCooldown = Math.max(0, this.crashCooldown - dt)
    const previousSpeed = this.speed
    const manualThrottle = Math.max(0, this.input.move.y, this.input.held('throttle') ? 1 : 0)
    const reverse = Math.max(0, -this.input.move.y)
    const brakePower = Math.max(this.input.brakeAmount, this.input.held('brake') ? 1 : 0, reverse)
    const brake = brakePower > 0.06
    this.braking = brake && this.speed > 3
    const turboType = TURBO_TYPES.find(item => item.id === this.progress.selectedTurbo)
    const turboHeld = this.input.held('turbo') && !!turboType && this.nitro > 0.01 && !this.crashTimer
    const drift = (this.input.held('drift') || brakePower > 0.62) && this.speed > 7
    this.driftActive = drift
    this.nitroEffect = turboHeld ? Math.min(1, this.nitroEffect + dt * 3.8) : Math.max(0, this.nitroEffect - dt * 2.6)

    const ability = CAR_ABILITIES[this.car.ability]
    const engineScale = (0.82 + this.car.acceleration * 0.035 + this.progress.engineUpgrade * 0.035) * ability.acceleration * this.driver.acceleration
    const speedScale = (0.82 + this.car.topSpeed * 0.036 + this.progress.engineUpgrade * 0.035) * ability.topSpeed
    const maxSpeed = CONFIG.race.maxSpeed * speedScale
    const acceleration = CONFIG.race.acceleration * engineScale
    if (this.crashTimer > 0) {
      this.crashTimer = Math.max(0, this.crashTimer - dt)
      this.speed = Math.max(4, this.speed - 11 * dt)
      if (this.crashTimer === 0) this.lateralVelocity *= -0.28
    } else if (brake) {
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
      this.nitro = Math.min(1, this.nitro + dt * turboType.recharge * ability.turboRecharge * this.driver.turboRecharge)
    } else {
      this.nitro = 0
    }

    const weather = this.conditions.weather
    const slippery = weather === 'rain' || weather === 'snow'
    const surfaceGrip = gripForConditions(this.conditions.biome.surface, weather, this.atmosphere.intensity)
    const tireScale = (0.8 + this.car.grip * 0.04 + this.progress.tireUpgrade * 0.075) * ability.grip * surfaceGrip * (slippery ? this.driver.wetGrip : 1)
    const steer = -this.input.move.x * this.input.sensitivity
    this.previousPlayerLane = this.laneOffset
    this.lateralVelocity = advanceLateralMotion({
      steer,
      speed: this.speed,
      steeringForce: CONFIG.race.steeringForce,
      tireGrip: tireScale,
      steeringSkill: ability.steering * this.driver.steering * (drift ? ability.drift : 1),
      drifting: drift,
      lateralVelocity: this.lateralVelocity,
      dt,
    })
    this.laneOffset += this.lateralVelocity * dt
    this.steerInput = steer
    if (Math.abs(steer) < 0.03 && !drift) this.laneOffset *= Math.exp(-0.16 * dt)

    if (Math.abs(this.laneOffset) > this.track.width * 0.5 - 1.2 && this.speed > CONFIG.race.crashSpeed && this.crashCooldown <= 0) {
      this.triggerCrash(Math.sign(this.laneOffset) || 1)
      this.laneOffset = THREE.MathUtils.clamp(this.laneOffset, -this.track.width * 0.5 + 1.25, this.track.width * 0.5 - 1.25)
      this.lateralVelocity = -Math.sign(this.laneOffset) * 3.5
    }
    if (Math.abs(this.laneOffset) > this.track.width * 0.35) this.speed = Math.max(0, this.speed - 5.2 * ability.offroadDrag * SURFACE_DRAG[this.conditions.biome.surface] * dt)
    this.longitudinalAccel = (this.speed - previousSpeed) / Math.max(0.001, dt)
    this.audio.updateEngine(this.speed, manualThrottle, turboHeld, true)

    if (this.crashTimer <= 0) this.trackDistance = Math.max(0, this.trackDistance + this.speed * dt)
    this.updateRivals(dt)
    if (this.mode !== 'playing') return
    this.updateCoDriver()
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
    if (this.mode === 'playing' || this.mode === 'countdown') {
      if (this.input.consume('camera')) this.cycleCamera()
    }
    this.atmosphere.update(frameSeconds, this.vehicle.position, this.mode === 'playing', this.reducedMotion)
    this.track.setWetness(this.atmosphere.wetness)
    if ((this.mode === 'attract' || this.mode === 'ended') && Math.abs(this.camera.fov - CONFIG.camera.fov) > 0.01) {
      this.camera.fov = CONFIG.camera.fov
      this.camera.updateProjectionMatrix()
    }
    const sample = this.track.sample(this.trackDistance, this.laneOffset)
    this.vehicle.position.copy(sample.position).setY(0.16 + (this.crashTimer > 0 ? Math.sin((0.9 - this.crashTimer) * Math.PI * 2) * 0.45 + 0.55 : 0))
    const slipAngle = THREE.MathUtils.clamp(Math.atan2(this.lateralVelocity, Math.max(4, Math.abs(this.speed))), -0.28, 0.28)
    const heading = sample.tangent.clone().applyAxisAngle(UP, slipAngle)
    this.vehicle.quaternion.setFromUnitVectors(FORWARD, heading)
    this.heading.copy(heading)
    if (this.crashTimer > 0) {
      this.body.position.y = 0
      this.body.rotation.set(0, this.bodyYaw, this.rollAngle())
    } else {
      const dt = Math.max(0, frameSeconds)
      const activeDrive = this.mode === 'playing' && !this.reducedMotion
      // Chassis weight transfer: braking loads the nose, throttle lifts it, and cornering loads the outside tyres.
      const targetPitch = activeDrive ? THREE.MathUtils.clamp(-this.longitudinalAccel * 0.0052, -0.12, 0.12) : 0
      const lateralRatio = this.lateralVelocity / Math.max(8, Math.abs(this.speed))
      const cornerLoad = this.steerInput * Math.min(1, Math.abs(this.speed) / 24)
      const targetRoll = activeDrive ? THREE.MathUtils.clamp(-cornerLoad * 0.052 - lateralRatio * (this.driftActive ? 0.075 : 0.045), -0.13, 0.13) : 0
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
    this.updateLights()
    this.updateParticles(frameSeconds)
    if (this.mode === 'attract' || this.mode === 'ended') {
      const orbit = this.time * 0.09
      const center = this.vehicle.position
      const radius = this.mode === 'attract' ? 10.5 : 14
      this.camera.position.set(center.x + Math.sin(orbit) * radius, 2.6 + Math.sin(this.time * 0.18) * 0.6, center.z + Math.cos(orbit) * radius)
      this.camera.lookAt(center.x, 1.1, center.z)
    } else {
      this.updateCamera(sample, frameSeconds)
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
      coDriver: this.coDriverTimer > 0 ? this.coDriverText : '',
      coDriverUrgent: this.coDriverUrgent,
      conditions: `${this.conditions.biome.label} · ${WEATHER_LABEL[this.conditions.weather]} · ${TIME_LABEL[this.timeNow()]}`,
      camera: this.cameraMode,
      standings: this.standings(),
    }
  }

  private timeNow(): 'dawn' | 'day' | 'sunset' | 'night' {
    const t = this.atmosphere.sunT
    if (t < 0.12 && t > -0.02) return 'dawn'
    if (t > 1.05 || t <= -0.02) return 'night'
    if (t > 0.8) return 'sunset'
    return 'day'
  }

  private standings(): { name: string; player: boolean }[] {
    const all = [{ name: this.driver.name, player: true, d: this.trackDistance }, ...this.rivals.map(r => ({ name: r.name, player: false, d: r.distance }))]
    return all.sort((a, b) => b.d - a.d).map(({ name, player }) => ({ name, player }))
  }

  private say(text: string, _spoken: string, urgent = false): void {
    this.coDriverText = text
    this.coDriverTimer = 3.2
    this.coDriverUrgent = urgent
  }

  /** Read the next corner 50–170 m ahead, once per lap. */
  private updateCoDriver(): void {
    const lap = Math.floor(this.trackDistance / this.track.length) + 1
    if (lap > this.lastLapAnnounced && lap <= this.stageLaps) {
      this.lastLapAnnounced = lap
      this.say(lap === this.stageLaps ? 'اللفة الأخيرة! ادفع بكل قوتك' : `اللفة ${lap}`, lap === this.stageLaps ? 'اللفة الأخيرة' : `اللفة ${lap}`)
      return
    }
    if (this.coDriverTimer > 1.4) return
    const L = this.track.length
    const here = ((this.trackDistance % L) + L) % L
    for (let i = 0; i < this.track.paceNotes.length; i += 1) {
      const note = this.track.paceNotes[i]
      const ahead = (note.distance - here + L) % L
      const key = `${lap}:${i}`
      const dir = note.direction === 'left' ? 'يسار' : 'يمين'
      const phase = paceNotePhase(ahead)
      if (phase === 'prepare' && !this.announced.has(`${key}:prepare`)) {
        this.announced.add(`${key}:prepare`)
        this.say(`استعد · ${describeNote(note, ahead)}`, `استعد ${dir} ${note.grade}`)
        return
      }
      if (phase === 'call' && !this.announced.has(`${key}:call`)) {
        this.announced.add(`${key}:call`)
        this.say(describeNote(note, ahead), `${dir} ${note.grade}${note.grade <= 2 ? '، اكبح' : ''}`, note.grade <= 2)
        return
      }
    }
  }

  private updateCamera(sample: { position: THREE.Vector3; tangent: THREE.Vector3; side: THREE.Vector3 }, frameSeconds: number): void {
    const mode = this.cameraMode
    const car = this.vehicle.position
    const h = this.heading
    const snap = !this.camera.userData.ready
    const target = this.tmpV2
    const desired = this.tmpV
    let follow = CONFIG.camera.follow
    let fovBoost = 0
    this.body.visible = true
    if (mode === 'chase' || mode === 'far') {
      const far = mode === 'far'
      const speedBlend = Math.min(1, Math.abs(this.speed) / CONFIG.race.maxSpeed)
      desired.copy(sample.position).addScaledVector(sample.tangent, -(CONFIG.camera.distance + (far ? 11 : 4) + speedBlend * 3.5)).add(new THREE.Vector3(0, CONFIG.camera.height + (far ? 6 : 3) + speedBlend * 1.2, 0))
      target.copy(sample.position).addScaledVector(sample.tangent, far ? 9 : 5).add(new THREE.Vector3(0, 1.7, 0))
    } else if (mode === 'hood' || mode === 'bumper') {
      const hood = mode === 'hood'
      // Hood cam sits just above the body's highest point so it never clips into imported models.
      if (this.body.userData.topY === undefined) {
        const box = new THREE.Box3().setFromObject(this.body)
        this.body.userData.topY = box.max.y - this.vehicle.position.y
        this.body.userData.frontZ = Math.max(1.6, (box.max.z - box.min.z) / 2)
      }
      const topY = this.body.userData.topY as number
      const frontZ = this.body.userData.frontZ as number
      void topY
      // Cockpit view hides the player's own body so imported models never block the windscreen.
      if (hood) this.body.visible = false
      desired.copy(car).addScaledVector(h, hood ? 0.6 : frontZ + 0.3).add(new THREE.Vector3(0, hood ? 1.35 : 0.72, 0))
      target.copy(car).addScaledVector(h, 30).add(new THREE.Vector3(0, hood ? 1.1 : 0.9, 0))
      follow = 60
      fovBoost = 6
    } else {
      // Trackside TV cameras: jump between fixed posts as the car passes them.
      const spacing = 140
      const post = Math.floor((this.trackDistance + spacing * 0.5) / spacing) * spacing
      const side = Math.floor(post / spacing) % 2 ? 1 : -1
      const p = this.track.sample(post + 25, side * (this.track.width / 2 + 10))
      desired.copy(p.position).setY(5.5)
      target.copy(car).setY(1)
      follow = 1000
    }
    if (snap) {
      this.camera.position.copy(desired)
      this.camera.userData.ready = true
    } else this.camera.position.lerp(desired, 1 - Math.exp(-follow * frameSeconds))
    this.camera.lookAt(target)
    const fov = CONFIG.camera.fov + fovBoost + (this.reducedMotion ? 0 : Math.min(3.5, Math.abs(this.speed) / CONFIG.race.maxSpeed * 3.5) + this.nitroEffect * 4.5) + (mode === 'tv' ? -18 : 0)
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix() }
    if (!this.reducedMotion && this.mode === 'playing' && mode !== 'tv') {
      this.camera.rotateZ(this.steerInput * 0.014 + (this.driftActive ? Math.sign(this.lateralVelocity) * 0.01 : 0))
      // Loose surfaces shake the cockpit views a little with speed.
      const loose = this.conditions.biome.surface !== 'tarmac'
      const rumble = (mode === 'hood' || mode === 'bumper' ? 0.012 : 0.004) * (loose ? 1 : 0.4) * Math.min(1, Math.abs(this.speed) / 30)
      this.camera.position.y += Math.sin(this.time * 31) * rumble
      this.camera.position.x += Math.cos(this.time * 27) * rumble
    }
    if (!this.reducedMotion && this.crashTimer > 0) {
      const shake = this.crashTimer * 0.28
      this.camera.position.x += Math.sin(this.time * 42) * shake
      this.camera.position.y += Math.cos(this.time * 37) * shake * 0.5
    }
  }

  private updateLights(): void {
    const dark = this.atmosphere.darkness
    const gloom = this.conditions.weather === 'clear' ? 0 : 0.35
    const lightsOn = Math.max(dark, gloom * 0.6)
    this.headlight.intensity = lightsOn * 260
    this.headlight.visible = lightsOn > 0.02
    const apply = (body: THREE.Group, brake: boolean) => {
      const tail = body.userData.tailLamp as THREE.MeshStandardMaterial | undefined
      const head = body.userData.headLamp as THREE.MeshStandardMaterial | undefined
      if (tail) tail.emissiveIntensity = (brake ? 2.6 : 0.35) + lightsOn * 1.2
      // Headlamp lenses brighten with the beam so cars read clearly in night and poor weather.
      if (head) head.emissiveIntensity = 0.6 + lightsOn * 2.8
    }
    apply(this.body, this.braking && this.mode === 'playing')
    for (const r of this.rivals) apply(r.body, false)
  }

  private updateParticles(dt: number): void {
    const biome = this.conditions.biome
    const wet = this.atmosphere.wetness > 0.4
    const color = this.tmpC.set(wet && biome.surface === 'tarmac' ? 0xc9d3dc : wet ? new THREE.Color(biome.dust).multiplyScalar(0.7).getHex() : biome.dust)
    const loose = biome.surface !== 'tarmac'
    const emitFor = (pos: THREE.Vector3, fwd: THREE.Vector3, speed: number, slide: number, rate: number) => {
      const s = Math.abs(speed)
      if (s < 4 || (!loose && !wet && slide < 1.5)) return
      const n = (rate * (s / CONFIG.race.maxSpeed) * (loose ? 1 : 0.5) + slide * 0.12) * (this.reducedMotion ? 0.12 : 1)
      let count = Math.floor(n)
      if (Math.random() < n - count) count += 1
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x)
      for (let i = 0; i < count; i += 1) {
        const wheel = Math.random() < 0.5 ? -0.85 : 0.85
        const at = pos.clone().addScaledVector(fwd, -1.6).addScaledVector(side, wheel).setY(0.25)
        const vel = fwd.clone().multiplyScalar(-s * 0.18).add(new THREE.Vector3((Math.random() - 0.5) * 3, 1.2 + Math.random() * 2.2, (Math.random() - 0.5) * 3)).addScaledVector(side, wheel * 1.2)
        this.particles.emit(at, vel, color, 0.9 + Math.random() * 1.1, (loose ? 1.4 : 0.9) + Math.random(), wet ? 0.45 : 0.55)
      }
    }
    if (this.mode === 'playing') {
      emitFor(this.vehicle.position, this.heading, this.speed, Math.abs(this.lateralVelocity) + (this.driftActive ? 3 : 0), 4)
      for (const r of this.rivals) {
        if (r.root.position.distanceToSquared(this.vehicle.position) > 90 * 90) continue
        emitFor(r.root.position, this.tmpV.set(0, 0, 1).applyQuaternion(r.root.quaternion), r.speed, 0, 1.6)
      }
      // Skid marks while sliding or braking hard.
      if ((this.driftActive || (this.braking && this.speed > 12) || Math.abs(this.lateralVelocity) > 3.5) && this.trackDistance - this.lastSkidDistance > 0.7) {
        this.lastSkidDistance = this.trackDistance
        const side = new THREE.Vector3(this.heading.z, 0, -this.heading.x)
        const yaw = Math.atan2(this.heading.x, this.heading.z)
        for (const w of [-0.8, 0.8]) this.skids.add(this.vehicle.position.clone().addScaledVector(this.heading, -1.3).addScaledVector(side, w), yaw)
      }
    }
    this.particles.update(dt, wet ? -6 : -2.2)
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

  private createVehicle(car: CampaignCar, color: string, lookOverride?: CarLook): THREE.Group {
    const look = lookOverride ?? lookFor(this.garage, car.id)
    const wrapper = new THREE.Group()
    const singleSource = (this.modelSources as THREE.Object3D).isObject3D
    const sources: CarModelSources = singleSource
      ? { 'dune-runner': this.modelSources as THREE.Object3D }
      : this.modelSources as CarModelSources
    const dedicatedSource = sources[car.id]
    if (!dedicatedSource && car.id !== 'dune-runner') {
      const model = buildRealisticCar(lookOverride ? car : { ...car, color }, look)
      wrapper.userData.procedural = true
      wrapper.userData.wheels = model.userData.wheels
      wrapper.userData.frontAxles = model.userData.frontAxles
      wrapper.userData.wheelAxles = model.userData.wheelAxles
      wrapper.userData.wheelRadius = model.userData.wheelRadius
      wrapper.userData.tailLamp = model.userData.tailLamp
      wrapper.userData.headLamp = model.userData.headLamp
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
    if (look.paint) tintVehicle(wrapper, look.paint)
    else if (!dedicatedSource || car.id === 'dune-runner') tintVehicle(wrapper, color)
    this.addVehicleEffects(wrapper)
    return wrapper
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

    // Imported GLB cars do not expose the procedural car's tail-lamp material.
    // Add a small, consistent pair so braking feedback works across every car.
    if (!wrapper.userData.tailLamp) {
      const tailLamp = new THREE.MeshStandardMaterial({
        color: 0x8c1a14,
        emissive: 0xff2010,
        emissiveIntensity: 0.35,
        roughness: 0.25,
      })
      for (const x of [-0.66, 0.66]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.06), tailLamp)
        lamp.name = 'zuma-fallback-tail-lamp'
        lamp.position.set(x, 0.82, -2.16)
        wrapper.add(lamp)
      }
      wrapper.userData.tailLamp = tailLamp
    }

    // Imported GLB cars may not expose a headlamp material for stage lighting.
    // Add a matching pair so their front lenses respond to night and poor weather.
    if (!wrapper.userData.headLamp) {
      const headLamp = new THREE.MeshStandardMaterial({
        color: 0xfff1d0,
        emissive: 0xffe2a0,
        emissiveIntensity: 0.6,
        roughness: 0.2,
      })
      for (const x of [-0.66, 0.66]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.06), headLamp)
        lamp.name = 'zuma-fallback-head-lamp'
        lamp.position.set(x, 0.82, 2.16)
        wrapper.add(lamp)
      }
      wrapper.userData.headLamp = headLamp
    }
  }

  private updateVehicleEffects(body: THREE.Group, speed: number, lateral: number, nitro: number, drifting: boolean, dt: number): void {
    const wheels = body.userData.wheels as THREE.Mesh[] | undefined
    const radius = (body.userData.wheelRadius as number | undefined) ?? 0.42
    wheels?.forEach(wheel => { wheel.rotation.x += (speed * dt) / radius })
    const frontAxles = body.userData.frontAxles as THREE.Group[] | undefined
    const steering = body === this.body ? this.steerInput : 0
    frontAxles?.forEach(axle => { axle.rotation.y = THREE.MathUtils.clamp(steering * 0.15, -0.24, 0.24) })
    // Independent wheel travel gives the body a planted, sprung feel over rough stages.
    const axles = body.userData.wheelAxles as THREE.Group[] | undefined
    axles?.forEach((axle, index) => {
      const base = radius
      const travel = this.reducedMotion ? 0 : Math.sin(this.time * (8 + Math.min(1, Math.abs(speed) / 30) * 5) + index * 1.73) * 0.018
      axle.position.y = base + travel
    })
    const flame = body.userData.nitroFlame as THREE.Mesh | undefined
    if (flame) {
      flame.visible = nitro > 0.02
      flame.scale.set(0.65 + nitro * 0.4, 0.55 + nitro * (0.9 + Math.sin(this.time * 38) * 0.12), 0.65 + nitro * 0.4)
      ;(flame.material as THREE.MeshBasicMaterial).opacity = nitro * 0.85
    }
    void lateral; void drifting
  }

  private buildRivals(): void {
    for (let i = 0; i < RIVAL_CARS.length; i += 1) {
      const root = new THREE.Group()
      const car = this.carFor(RIVAL_CARS[i])
      const body = this.createVehicle(car, RIVAL_COLORS[i], { ...DEFAULT_LOOK, paint: RIVAL_COLORS[i], number: 11 + i * 9, livery: (['rally', 'stripes', 'number', 'split', 'rally', 'number'] as const)[i] })
      root.add(body)
      this.scene.add(root)
      const lane = i % 2 === 0 ? -3.2 : 3.2
      this.rivals.push({ root, body, distance: 0, speed: 0, lane, previousLane: lane, targetLane: lane, targetSpeed: 0, decisionTimer: 0, randomState: i + 1, swerveVelocity: 0, ability: car.ability, name: RIVAL_DRIVERS[i] })
    }
  }

  private replaceTrack(stageNumber: number): void {
    this.scene.remove(this.track.group)
    this.track.dispose()
    this.track = new RallyTrack(stageNumber, CONFIG.race.trackWidth + Math.min(2, Math.floor(stageNumber / 40)))
    this.lastSkidDistance = 0
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
        const playerAhead = this.trackDistance - rival.distance
        const playerClose = Math.abs(playerAhead) < 26 && Math.abs(this.laneOffset - rival.lane) < 4.8
        const traffic = this.rivals
          .filter(other => other !== rival && Math.abs(other.distance - rival.distance) < 22 && Math.abs(other.lane - rival.lane) < 3.8)
          .sort((a, b) => Math.abs(a.distance - rival.distance) - Math.abs(b.distance - rival.distance))[0]
        const threatLane = playerClose ? this.laneOffset : traffic?.lane
        if (threatLane !== undefined) rival.targetLane = passingLane(rival.lane, threatLane, laneLimit * 0.82) else {
          rival.targetLane = laneRoll < 0.17
            ? (this.nextRivalRandom(rival) < 0.5 ? -1 : 1) * laneLimit * 0.82
            : (this.nextRivalRandom(rival) * 2 - 1) * laneLimit * 0.8
        }
        const pace = 0.73 + this.stageNumber * 0.0017 + (this.nextRivalRandom(rival) - 0.5) * 0.11
        const closingBoost = playerAhead > 0 && playerAhead < 38 ? 1.045 : 1
        rival.targetSpeed = CONFIG.race.maxSpeed * pace * CAR_ABILITIES[rival.ability].topSpeed * closingBoost
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
