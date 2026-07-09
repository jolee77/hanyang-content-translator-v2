export interface ChunkProgress {
  current: number
  total: number
  phase: string
  percent: number
  /** 현재 묶음 API 호출 대기 중 */
  waiting?: boolean
}

export function chunkProgress(
  current: number,
  total: number,
  phase: string,
): ChunkProgress {
  const safeTotal = Math.max(total, 1)
  return {
    current,
    total,
    phase,
    percent: Math.min(100, Math.max(0, Math.round((current / safeTotal) * 100))),
  }
}

export function mergeChunkProgress(
  batchIndex: number,
  batchTotal: number,
  phase: string,
): ChunkProgress {
  return chunkProgress(batchIndex, batchTotal, phase)
}
