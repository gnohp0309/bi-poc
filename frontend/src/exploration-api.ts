import { api } from './api'

export type ColumnProfile = {
  name: string; label: string; type: string; kind: string
  nullCount: number; blankCount: number; missingCount: number; missingRate: number | null
  validCount: number; distinctCount: number; invalidCount: number
  importMissingCount?: number; importInvalidCount?: number; importInvalidExamples?: string[]
  statisticsAvailable: boolean; statisticsNote: string; modeNote: string
  min?: number | string | null; max?: number | string | null; mean?: number | null
  median?: number | null; q1?: number | null; q3?: number | null
  standardDeviation?: number | null; variance?: number | null; mode: string | null
  topValues: { value: string; frequency: number }[]; topValuesTruncated: boolean
}
export type ExplorationReport = {
  datasetId: string; name: string; kind: string; generatedAt: string
  scope: 'full-dataset'; sampled: boolean
  overview: { rowCount: number; columnCount: number; sizeBytes: number; sizeDescription: string; missingRate: number | null }
  columns: ColumnProfile[]
  quality: {
    missingCells: number; invalidCells: number; duplicateRows: number; duplicateDescription: string; rules: string[]
    importSnapshot?: { row_count: number; missing_count: number; invalid_count: number; created_at: string }
  }
  warnings: string[]
}
export const getExplorationReport = (id: string) =>
  api<ExplorationReport>(`/datasets/${encodeURIComponent(id)}/exploration`)

// Statistics must preserve the distinction between zero, missing and unavailable values.
export function formatStatistic(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return Number.isFinite(value)
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(value) : '—'
  return String(value)
}
