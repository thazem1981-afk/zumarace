/**
 * Rally co-driver pace notes. Scans a closed track centre-line for corners and grades them
 * on the classic 1–6 scale (1 = hairpin-tight, 6 = nearly flat out).
 */

export type Vec2 = { x: number; z: number }
export type PaceNote = Readonly<{ distance: number; direction: 'left' | 'right'; grade: number; length: number }>

/**
 * Signed heading change from tangent a to tangent b in radians.
 * Cars drive toward +z with +x on their left, so a positive y-cross is a left turn.
 */
export function turnAngle(a: Vec2, b: Vec2): number {
  const cross = a.z * b.x - a.x * b.z
  const dot = a.x * b.x + a.z * b.z
  return Math.atan2(cross, dot)
}

/** Map heading change over a fixed window (radians per `window` metres) to a 1–6 grade, or 0 for straight. */
export function gradeFor(angle: number): number {
  const a = Math.abs(angle)
  if (a < 0.16) return 0
  if (a > 1.1) return 1
  if (a > 0.8) return 2
  if (a > 0.56) return 3
  if (a > 0.38) return 4
  if (a > 0.25) return 5
  return 6
}

/**
 * Build notes from tangents sampled every `step` metres along a loop.
 * Consecutive samples with the same direction merge into one corner, graded by its sharpest window.
 */
export function buildPaceNotes(tangents: readonly Vec2[], step: number, window = 30): PaceNote[] {
  const n = tangents.length
  if (n < 4) return []
  const span = Math.max(1, Math.round(window / step))
  const notes: PaceNote[] = []
  let current: { start: number; dir: 'left' | 'right'; grade: number; end: number } | null = null
  for (let i = 0; i < n; i += 1) {
    const angle = turnAngle(tangents[i], tangents[(i + span) % n])
    const grade = gradeFor(angle)
    const dir = angle > 0 ? 'left' : 'right'
    if (grade > 0) {
      if (current && current.dir === dir && i - current.end <= 1) {
        current.end = i
        current.grade = Math.min(current.grade, grade)
      } else {
        if (current) notes.push(finish(current, step))
        current = { start: i, dir, grade, end: i }
      }
    } else if (current) {
      notes.push(finish(current, step))
      current = null
    }
  }
  if (current) notes.push(finish(current, step))
  return notes
}

function finish(c: { start: number; dir: 'left' | 'right'; grade: number; end: number }, step: number): PaceNote {
  return { distance: c.start * step, direction: c.dir, grade: c.grade, length: (c.end - c.start + 1) * step }
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const ar = (n: number) => String(n).replace(/\d/g, d => AR_DIGITS[Number(d)])

export function describeNote(note: PaceNote, metresAway: number): string {
  const dir = note.direction === 'left' ? 'يسار' : 'يمين'
  const extra = note.grade <= 2 ? ' — اكبح!' : note.length > 60 ? ' طويل' : ''
  const dist = Math.max(20, Math.round(metresAway / 10) * 10)
  return `${dir} ${ar(note.grade)}${extra} · بعد ${ar(dist)} م`
}

/** Two-stage co-driver timing: prepare early, then deliver the actionable corner call. */
export function paceNotePhase(metresAway: number): 'prepare' | 'call' | null {
  if (!Number.isFinite(metresAway) || metresAway < 42) return null
  if (metresAway >= 125 && metresAway <= 180) return 'prepare'
  if (metresAway < 125) return 'call'
  return null
}
