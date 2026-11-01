/** Compact replay snapshots: only deterministic race state is stored, never Three.js objects. */
export type ReplayFrame = Readonly<{
  time: number
  distance: number
  lane: number
  speed: number
  lateralVelocity: number
  longitudinalAccel: number
  steerInput: number
  drifting: boolean
  braking: boolean
  rivals: readonly Readonly<{ distance: number; lane: number }>[]
}>

/** Interpolate a replay snapshot at elapsed race time without mutating the recorded frames. */
export function sampleReplay(frames: readonly ReplayFrame[], time: number): ReplayFrame | null {
  if (frames.length === 0) return null
  if (frames.length === 1 || time <= frames[0].time) return frames[0]
  const last = frames[frames.length - 1]
  if (time >= last.time) return last
  let nextIndex = frames.findIndex(frame => frame.time >= time)
  if (nextIndex < 1) nextIndex = 1
  const before = frames[nextIndex - 1]
  const after = frames[nextIndex]
  const span = Math.max(0.0001, after.time - before.time)
  const blend = Math.max(0, Math.min(1, (time - before.time) / span))
  const lerp = (a: number, b: number) => a + (b - a) * blend
  const rivals = before.rivals.map((rival, index) => ({
    distance: lerp(rival.distance, after.rivals[index]?.distance ?? rival.distance),
    lane: lerp(rival.lane, after.rivals[index]?.lane ?? rival.lane),
  }))
  return {
    time,
    distance: lerp(before.distance, after.distance),
    lane: lerp(before.lane, after.lane),
    speed: lerp(before.speed, after.speed),
    lateralVelocity: lerp(before.lateralVelocity, after.lateralVelocity),
    longitudinalAccel: lerp(before.longitudinalAccel, after.longitudinalAccel),
    steerInput: lerp(before.steerInput, after.steerInput),
    drifting: blend < 0.5 ? before.drifting : after.drifting,
    braking: blend < 0.5 ? before.braking : after.braking,
    rivals,
  }
}
