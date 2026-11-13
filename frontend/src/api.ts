export type Actor = { id: string; username: string; role: 'ADMIN' | 'ANALYST' | 'VIEWER' }
export type Connection = { id: string; name: string; host: string; port: number; database_name: string; username: string }
export type Dataset = { id: string; connection_id: string; connection_name: string; name: string; kind: 'PHYSICAL' | 'VIRTUAL'; source_name: string | null; sql_definition: string | null; aliases_json: string }
export type ChartType = 'bar' | 'line' | 'pie' | 'donut' | 'kpi' | 'histogram' | 'scatter' | 'heatmap' | 'map' | 'stacked-bar' | 'stacked-area'
export type Chart = { id: string; dataset_id: string; dataset_name: string; name: string; chart_type: ChartType; dimension: string; metric: string; aggregate: 'sum' | 'count' | 'avg'; time_grain?: 'month' | null }
export type ChartData = { columns?: string[]; rowKeys?: string[]; datasetId?: string; id?: string; name?: string; chartType: ChartType; dimension: string; metric: string; aggregate: string; timeGrain?: 'month' | null; rows: Record<string, unknown>[]; position?: number; x?: number; y?: number; w?: number; h?: number; numericColumns?: string[]; seriesDimension?: string; truncated?: boolean; notes?: string[] }
export type ChartDefinition = { id: string; datasetId: string; name: string; chartType: ChartType; dimension: string; metric: string; aggregate: 'sum' | 'avg' | 'count'; timeGrain?: 'month' | null; seriesDimension?: string; numericColumns?: string[]; binCount?: number; latitude?: string; longitude?: string; labelColumn?: string }
export type Dashboard = { id: string; name: string; chart_count: number; share_token: string | null }
export type DashboardDetail = Dashboard & { charts: ChartData[]; scopeFilters?: import('./dashboard-interaction').DashboardFilter[] }
export type QueryResult = { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }
export type FileImport = {
  id: string; file_name: string; row_count: number; missing_count: number; invalid_count: number;
  dataset_id: string; dashboard_id: string; created_at: string;
  columns?: { original: string; name: string; type: 'TEXT' | 'NUMERIC' | 'DATE'; missing: number; invalid: number; invalidExamples: string[]; validCount?: number; sum?: number; average?: number; min?: number; max?: number }[];
  analysis?: { rowCount: number; missingCells: number; invalidCells: number; chartCount: number; cleaningRule: string }
}
export type Conversation = { id: string; dataset_id: string; dataset_name: string; title: string; message_count: number; created_at: string; updated_at: string }
export type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; content: string; metadata_json: string; created_at: string }
export type ConversationDetail = { id: string; dataset_id: string; title: string; created_at: string; updated_at: string; messages: ChatMessage[] }
export type ChatResponse = { message_id: string; intent: string; answer: string; data?: QueryResult; dashboard_id?: string; analysis_result?: import('./chat-result-model').AnalysisResult }

export async function uploadCsv(file: File, title: string): Promise<FileImport> {
  const form = new FormData()
  form.append('file', file)
  if (title.trim()) form.append('title', title.trim())
  const token = sessionStorage.getItem('bi_poc_token')
  const response = await fetch('/api/imports', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || `Lỗi HTTP ${response.status}`)
  return data as FileImport
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = sessionStorage.getItem('bi_poc_token')
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  let data: unknown
  try { data = await response.json() } catch { data = null }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : `Lỗi HTTP ${response.status}`
    if (response.status === 401 && path !== '/auth/login') {
      sessionStorage.removeItem('bi_poc_token')
      window.dispatchEvent(new Event('bi-poc-logout'))
    }
    throw new Error(message)
  }
  return data as T
}

export const formatNumber = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n) : String(value ?? '—')
}
