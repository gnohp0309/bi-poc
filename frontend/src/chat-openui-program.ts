import type { ChartData } from './api'
import type { ResultTable } from './chat-result-model'

const chartTypes = new Set(['bar', 'line', 'pie', 'donut'])
const MAX_CHART_POINTS = 60

// Programs contain fixed components with inert JSON arguments built from the executed results.
export function openUiChartProgram(chart: ChartData): string | undefined {
  if (!chartTypes.has(chart.chartType) || !chart.rows.length || chart.rows.length > MAX_CHART_POINTS) return
  const circular = chart.chartType === 'pie' || chart.chartType === 'donut'
  const points: { group: string; 'Giá trị': number }[] = []
  for (const row of chart.rows) {
    const { label, value } = row
    if (typeof label !== 'string' && typeof label !== 'number') return
    if (typeof value !== 'number' && typeof value !== 'string') return
    if (typeof value === 'string' && !value.trim()) return
    const amount = Number(value)
    const group = String(label)
    if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER || group.length > 80 || (circular && amount < 0)) return
    points.push({ group, 'Giá trị': amount })
  }
  if (circular && !points.some(point => point['Giá trị'] > 0)) return
  return `root = Chart(${JSON.stringify(chart.chartType)}, ${JSON.stringify(points)}, "group", ["Giá trị"], "number", false, 260)`
}

export function openUiTableProgram(columns: string[], rows: ResultTable['rows']): string | undefined {
  if (!columns.length || columns.length > 10 || !rows.length) return
  const cells: string[][] = []
  for (const row of rows) {
    const line: string[] = []
    for (const column of columns) {
      const value = Object.hasOwn(row, column) ? row[column] : undefined
      const cell = value === null ? 'NULL' : value === undefined ? '—' : String(value)
      // The upstream table interprets inline Markdown. Keep these cells literal in the native table.
      if (cell.length > 240 || /[\x60*_~\[]/.test(cell)) return
      line.push(cell)
    }
    cells.push(line)
  }
  return `root = Table(${JSON.stringify(columns)}, ${JSON.stringify(cells)})`
}
