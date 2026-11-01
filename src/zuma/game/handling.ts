/**
 * Small, deterministic lateral-tyre model used by the rally controller.
 * Steering demand saturates at the available tyre force; a deliberate drift
 * trades cornering grip for a longer-lasting sideways slide.
 */
export type LateralMotion = Readonly<{
  steer: number
  speed: number
  steeringForce: number
  tireGrip: number
  steeringSkill: number
  drifting: boolean
  lateralVelocity: number
  dt: number
}>

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function advanceLateralMotion(input: LateralMotion): number {
  const dt = Math.max(0, input.dt)
  if (dt === 0) return input.lateralVelocity

  const speedFactor = clamp(0.58 + Math.abs(input.speed) / 23, 0.58, 1.4)
  const driftGrip = input.drifting ? 0.76 : 1
  const grip = Math.max(0.1, input.tireGrip)
  const requestedAcceleration = input.steer * input.steeringForce * grip * input.steeringSkill * speedFactor
  const availableAcceleration = 9.81 * grip * driftGrip
  const lateralAcceleration = clamp(requestedAcceleration, -availableAcceleration, availableAcceleration)
  const damping = (input.drifting ? 0.92 : 2.8) * Math.sqrt(grip)
  return clamp((input.lateralVelocity + lateralAcceleration * dt) * Math.exp(-damping * dt), -12, 12)
}

/** Pick a safe passing lane away from a nearby car while staying inside the usable road. */
export function passingLane(currentLane: number, threatLane: number, laneLimit: number): number {
  const limit = Math.max(0, laneLimit)
  const side = currentLane <= threatLane ? -1 : 1
  const candidate = clamp(threatLane + side * 3.5, -limit, limit)
  if (Math.abs(candidate - threatLane) > 2.2) return candidate
  return candidate >= 0 ? -limit : limit
}
