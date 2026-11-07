import type { ChartData } from './api'

export type ResultValue = string | number | null
export type Measurement = { status: 'available' | 'not_applicable' | 'not_computed'; value: ResultValue; name?: string; reason?: string }
export type ResultTable = { columns: string[]; rows: Record<string, string | number | boolean | null>[]; truncated: boolean; receivedRows: number }
export type AnalysisResult = {
  schemaVersion: 1; kind: 'query' | 'statistical_test'; status: 'success' | 'insufficient_data' | 'not_applicable' | 'error'
  title: string; summary?: string; method?: string; hypotheses?: { h0?: string; h1?: string }; alpha?: ResultValue
  sample?: { total?: ResultValue; used?: ResultValue; missing?: ResultValue; groups: { name: string; count: ResultValue }[] }
  statistic?: Measurement; pValue?: Measurement
  confidenceInterval?: { status: Measurement['status']; lower: ResultValue; upper: ResultValue; level?: ResultValue; reason?: string }
  effectSize?: Measurement
  assumptions: { name: string; status: 'passed' | 'failed' | 'not_checked' | 'not_applicable'; detail?: string }[]
  warnings: string[]; conclusion?: string; reason?: string; data?: ResultTable; charts: ChartData[]
  provenance?: { engine?: string; version?: string; sampled?: boolean; sampleSize?: ResultValue; missingPolicy?: string; scope?: string }
}
export type ParsedChatResult = { result?: AnalysisResult; table?: ResultTable; dashboardId?: string; problems: string[] }
type Obj = Record<string, unknown>
const object = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)
const string = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v : undefined
const value = (v: unknown): ResultValue => typeof v === 'string' && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(v) || typeof v === 'number' && Number.isFinite(v) ? v as ResultValue : null
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 100) : []
const member = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && values.includes(v as T)
const statuses = ['available', 'not_applicable', 'not_computed'] as const
function measurement(v: unknown): Measurement | undefined {
  if (!object(v)) return undefined
  return { status: member(v.status, statuses) ? v.status : 'not_computed', value: value(v.value), name: string(v.name), reason: string(v.reason) }
}
export function parseResultTable(v: unknown): ResultTable | undefined {
  if (!object(v) || !Array.isArray(v.columns) || !v.columns.every(c => typeof c === 'string') || v.columns.length > 64 || new Set(v.columns).size !== v.columns.length || !Array.isArray(v.rows)) return undefined
  const columns = v.columns as string[]
  if (v.rows.some(r => !object(r) || columns.some(c => r[c] !== undefined && r[c] !== null && typeof r[c] !== 'string' && typeof r[c] !== 'boolean' && !(typeof r[c] === 'number' && Number.isFinite(r[c]))))) return undefined
  return { columns, rows: v.rows.slice(0, 500) as ResultTable['rows'], receivedRows: v.rows.length, truncated: v.truncated === true || v.rows.length > 500 }
}
const chartTypes = ['bar', 'line', 'pie', 'donut', 'kpi', 'histogram', 'scatter', 'heatmap', 'map', 'stacked-bar', 'stacked-area'] as const
function chart(v: unknown): ChartData | undefined {
  if (!object(v) || !member(v.chartType, chartTypes) || !Array.isArray(v.rows) || v.rows.length > 500 || !v.rows.every(object)) return undefined
  const required = v.chartType === 'heatmap' ? ['x', 'y', 'value'] : v.chartType === 'scatter' ? ['x', 'y'] : v.chartType === 'map' ? ['x', 'y', 'value'] : v.chartType === 'histogram' ? ['lower_bound', 'upper_bound', 'value'] : v.chartType === 'kpi' ? ['value'] : v.chartType.startsWith('stacked-') ? ['label', 'series', 'value'] : ['label', 'value']
  if (!v.rows.every(r => required.every(key => Object.hasOwn(r, key)))) return undefined
  const numericKeys = v.chartType === 'scatter' ? ['x', 'y'] : v.chartType === 'map' ? ['x', 'y', 'value'] : v.chartType === 'histogram' ? ['lower_bound', 'upper_bound', 'value'] : ['value']
  if (!v.rows.every(r => numericKeys.every(key => r[key] === null || value(r[key]) !== null))) return undefined
  return {
    chartType: v.chartType, name: string(v.name), dimension: string(v.dimension) || '', metric: string(v.metric) || '', aggregate: string(v.aggregate) || '',
    rows: v.rows as Record<string, unknown>[], notes: strings(v.notes), truncated: v.truncated === true,
    ...(Array.isArray(v.numericColumns) ? { numericColumns: strings(v.numericColumns) } : {}),
  }
}
export function parseChatResult(metadataJson: string): ParsedChatResult {
  const parsed: ParsedChatResult = { problems: [] }
  let metadata: unknown
  if (metadataJson.length > 2_000_000) return { problems: ['Kết quả đã lưu quá lớn để hiển thị trong một tin nhắn.'] }
  try { metadata = JSON.parse(metadataJson) } catch { return { problems: ['Không đọc được dữ liệu kết quả đã lưu. Nội dung tin nhắn vẫn được giữ.'] } }
  if (!object(metadata)) return { problems: ['Metadata kết quả không đúng định dạng.'] }
  if (typeof metadata.dashboard_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metadata.dashboard_id)) parsed.dashboardId = metadata.dashboard_id
  if (metadata.data !== undefined) {
    parsed.table = parseResultTable(metadata.data)
    if (!parsed.table) parsed.problems.push('Bảng kết quả không hợp lệ nên chưa thể hiển thị.')
  }
  const raw = metadata.analysis_result
  if (raw === undefined) return parsed
  if (!object(raw) || raw.schemaVersion !== 1 || !member(raw.kind, ['query', 'statistical_test']) || !member(raw.status, ['success', 'insufficient_data', 'not_applicable', 'error'])) {
    parsed.problems.push('Phiên bản hoặc cấu trúc kết quả phân tích chưa được hỗ trợ.'); return parsed
  }
  const result: AnalysisResult = {
    schemaVersion: 1, kind: raw.kind, status: raw.status, title: string(raw.title) || (raw.kind === 'statistical_test' ? 'Kết quả kiểm định thống kê' : 'Kết quả phân tích'),
    summary: string(raw.summary), method: string(raw.method), alpha: value(raw.alpha), statistic: measurement(raw.statistic), pValue: measurement(raw.pValue), effectSize: measurement(raw.effectSize),
    warnings: strings(raw.warnings), conclusion: string(raw.conclusion), reason: string(raw.reason), assumptions: [], charts: [],
  }
  if (raw.data !== undefined) {
    result.data = parseResultTable(raw.data)
    if (!result.data) parsed.problems.push('Bảng dữ liệu của kết quả có cấu trúc không hợp lệ.')
  }
  if (!result.data && parsed.table) result.data = parsed.table
  if (object(raw.hypotheses)) result.hypotheses = { h0: string(raw.hypotheses.h0), h1: string(raw.hypotheses.h1) }
  if (object(raw.sample)) result.sample = {
    total: value(raw.sample.total), used: value(raw.sample.used), missing: value(raw.sample.missing),
    groups: Array.isArray(raw.sample.groups) ? raw.sample.groups.filter(object).slice(0, 50).map(g => ({ name: string(g.name) || 'Nhóm chưa đặt tên', count: value(g.count) })) : [],
  }
  if (object(raw.confidenceInterval)) {
    const ci = raw.confidenceInterval
    result.confidenceInterval = { status: member(ci.status, statuses) ? ci.status : 'not_computed', lower: value(ci.lower), upper: value(ci.upper), level: value(ci.level), reason: string(ci.reason) }
  }
  if (Array.isArray(raw.assumptions)) result.assumptions = raw.assumptions.filter(object).slice(0, 50).map(a => ({
    name: string(a.name) || 'Giả định', status: member(a.status, ['passed', 'failed', 'not_checked', 'not_applicable']) ? a.status : 'not_checked', detail: string(a.detail),
  }))
  if (object(raw.provenance)) result.provenance = {
    engine: string(raw.provenance.engine), version: string(raw.provenance.version), sampled: typeof raw.provenance.sampled === 'boolean' ? raw.provenance.sampled : undefined,
    sampleSize: value(raw.provenance.sampleSize), missingPolicy: string(raw.provenance.missingPolicy), scope: string(raw.provenance.scope),
  }
  if (Array.isArray(raw.charts)) for (const input of raw.charts.slice(0, 6)) {
    const valid = chart(input); if (valid) result.charts.push(valid); else parsed.problems.push('Một biểu đồ có cấu hình không hợp lệ đã được bỏ qua.')
  }
  if (Array.isArray(raw.charts) && raw.charts.length > 6) parsed.problems.push('Chỉ hiển thị tối đa 6 biểu đồ trong một kết quả.')
  parsed.result = result; return parsed
}
export function formatResultValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—'
    if (v !== 0 && Math.abs(v) < 0.0001) return v.toExponential(5)
    return new Intl.NumberFormat('vi-VN', { maximumSignificantDigits: 10 }).format(v)
  }
  return typeof v === 'string' || typeof v === 'boolean' ? String(v) : '—'
}
