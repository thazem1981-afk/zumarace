/** Deterministic six-speed rally gearbox shared by automatic and manual modes. */
export type TransmissionMode = 'automatic' | 'manual'
const UPSHIFT_SPEEDS = [0, 10, 19, 28, 37, 46] as const
const TOP_SPEED = [0, 0.34, 0.51, 0.67, 0.81, 0.92, 1] as const
const ACCELERATION = [0, 1.42, 1.22, 1.08, 0.97, 0.87, 0.79] as const
const clampGear = (gear: number) => Math.max(1, Math.min(6, Math.floor(Number.isFinite(gear) ? gear : 1)))
export function automaticGear(speed: number): number {
  const velocity = Math.max(0, Number.isFinite(speed) ? speed : 0)
  let gear = 1
  for (let index = 1; index < UPSHIFT_SPEEDS.length; index += 1) if (velocity >= UPSHIFT_SPEEDS[index]) gear = index + 1
  return gear
}
export function gearTopSpeed(gear: number): number { return TOP_SPEED[clampGear(gear)] }
export function gearAcceleration(gear: number): number { return ACCELERATION[clampGear(gear)] }
export function engineRpm(speed: number, gear: number): number {
  const g = clampGear(gear)
  const lower = UPSHIFT_SPEEDS[g - 1]
  const upper = g === 6 ? 58 : UPSHIFT_SPEEDS[g] + 8
  const progress = Math.max(0, Math.min(1, (Math.max(0, speed) - lower) / Math.max(1, upper - lower)))
  return Math.round(950 + progress * 6050)
}
export function shiftGear(gear: number, direction: -1 | 1): number { return clampGear(gear + direction) }
