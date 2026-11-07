import type { ChartData, DashboardDetail, Dataset } from './api'
import type { DashboardFilter } from './dashboard-interaction'
export type ExportSnapshot = { dashboard: DashboardDetail; filterLabels: string[]; refreshedAt: string; exportedAt: string }
export function filterLabels(filters: DashboardFilter[], datasets: Dataset[]): string[] {
  return filters.map(f => `${datasets.find(d => d.id === f.datasetId)?.name || f.datasetId} · ${f.column}: ${f.op === 'null' ? 'NULL' : f.op === 'date' ? `${f.value} → ${f.end} (UTC)` : `= ${f.value}`}`)
}
export function fileBase(name: string, exportedAt: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 90) || 'Dashboard'
  return `${cleaned}-${exportedAt.replace(/[:.]/g, '-')}`
}
export function sheetName(title: string, index: number): string {
  // The numeric prefix makes sheet names unique, including names equal to the summary sheet.
  const cleaned = title.replace(/[\\/*?:\[\]\u0000-\u001f]/g, '_').replace(/^'+|'+$/g, '').trim() || 'Biểu đồ'
  return `${String(index + 1).padStart(2, '0')}. ${cleaned}`.slice(0, 31).replace(/'+$/g, '')
}
export function dataColumns(chart: ChartData): string[] {
  return [...new Set([...(chart.columns || []), ...chart.rows.flatMap(row => Object.keys(row))])]
}
export function cellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  // Excel stores 15 significant digits. Keep large integers/decimal strings as text.
  if (typeof value === 'number') {
    const digits = value.toExponential().split('e')[0].replace(/[^0-9]/g, '').replace(/0+$/g, '').length
    return Number.isFinite(value) && digits <= 15 && Math.abs(value) < 1e15 && (value === 0 || Math.abs(value) >= 2.2250738585072014e-308) ? value : String(value)
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}
export type Box = { top: number; bottom: number }
export function pageSlices(height: number, capacity: number, boxes: Box[]): { top: number; height: number }[] {
  if (!Number.isFinite(height) || !Number.isFinite(capacity) || height <= 0 || capacity < 1) throw new Error('Kích thước trang xuất không hợp lệ.')
  const pages = []; let top = 0
  while (top < height) {
    const ideal = Math.min(height, top + capacity)
    let bottom = ideal
    if (ideal < height && boxes.some(b => b.top < ideal && b.bottom > ideal)) {
      const boundaries = boxes.flatMap(b => [b.top, b.bottom]).filter(y => y > top + 1 && y <= ideal && !boxes.some(b => b.top < y && b.bottom > y))
      if (boundaries.length) bottom = Math.max(...boundaries)
    }
    pages.push({ top, height: bottom - top }); top = bottom
    if (pages.length > 100) throw new Error('Dashboard quá dài để xuất PDF. Hãy thu gọn bố cục.')
  }
  return pages
}
