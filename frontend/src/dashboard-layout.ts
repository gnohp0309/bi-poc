import type { ChartData } from './api'

export type GridItem = { chartId: string; x: number; y: number; w: number; h: number }
export const GRID_COLUMNS = 12
export const GRID_ROW_HEIGHT = 32
export const GRID_GAP = 16
export function overlaps(a: GridItem, b: GridItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}
export function readLayout(charts: ChartData[]): GridItem[] {
  return charts.filter(c => c.id).map((c, i) => {
    const p = c.position ?? i
    return { chartId: c.id!, x: c.x ?? p % 2 * 6, y: c.y ?? Math.floor(p / 2) * 9, w: c.w ?? 6, h: c.h ?? 9 }
  })
}
export function ordered(items: GridItem[]): GridItem[] { return [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.chartId.localeCompare(b.chartId)) }
export function placeItem(items: GridItem[], candidate: GridItem): GridItem[] {
  if (!items.some(i => i.chartId === candidate.chartId)) throw new Error('Không tìm thấy ô biểu đồ.')
  if (![candidate.x, candidate.y, candidate.w, candidate.h].every(Number.isInteger)) throw new Error('Tọa độ và kích thước phải là số nguyên.')
  const w = Math.max(3, Math.min(12, candidate.w)), h = Math.max(6, Math.min(24, candidate.h))
  const active = { ...candidate, w, h, x: Math.max(0, Math.min(12 - w, candidate.x)), y: Math.max(0, Math.min(1000 - h, candidate.y)) }
  const placed = [active]
  for (const item of ordered(items.filter(i => i.chartId !== active.chartId))) {
    const next = { ...item }
    let collision: GridItem | undefined
    while ((collision = placed.find(i => overlaps(i, next)))) next.y = collision.y + collision.h
    if (next.y + next.h > 1000) throw new Error('Bố cục vượt giới hạn 1000 hàng.')
    placed.push(next)
  }
  return items.map(i => placed.find(p => p.chartId === i.chartId)!)
}
export function appendItem(items: GridItem[], chartId: string): GridItem[] {
  if (items.some(i => i.chartId === chartId)) throw new Error('Biểu đồ đã có trong dashboard.')
  if (items.length >= 24) throw new Error('Dashboard chỉ hỗ trợ tối đa 24 biểu đồ.')
  for (let y = 0; y <= 991; y++) for (let x = 0; x <= 6; x += 3) {
    const next = { chartId, x, y, w: 6, h: 9 }
    if (!items.some(i => overlaps(i, next))) return [...items, next]
  }
  throw new Error('Không còn vị trí phù hợp trong lưới.')
}
