export type Actor = { id: string; username: string; role: 'ADMIN' | 'ANALYST' | 'VIEWER' }
export type Connection = { id: string; name: string; host: string; port: number; database_name: string; username: string }
export type Dataset = { id: string; connection_id: string; connection_name: string; name: string; kind: 'PHYSICAL' | 'VIRTUAL'; source_name: string | null; sql_definition: string | null; aliases_json: string }
export type Chart = { id: string; dataset_id: string; dataset_name: string; name: string; chart_type: 'bar' | 'line' | 'pie'; dimension: string; metric: string; aggregate: 'sum' | 'count' | 'avg' }
export type ChartData = { id?: string; name?: string; chartType: 'bar' | 'line' | 'pie'; dimension: string; metric: string; aggregate: string; rows: Record<string, unknown>[]; position?: number }
export type Dashboard = { id: string; name: string; chart_count: number; share_token: string | null }
export type DashboardDetail = Dashboard & { charts: ChartData[] }
export type QueryResult = { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }
export type FileImport = {
  id: string; file_name: string; row_count: number; missing_count: number; invalid_count: number;
  dataset_id: string; dashboard_id: string; created_at: string;
  columns?: { original: string; name: string; type: 'TEXT' | 'NUMERIC' | 'DATE'; missing: number; invalid: number; invalidExamples: string[]; validCount?: number; sum?: number; average?: number; min?: number; max?: number }[];
  analysis?: { rowCount: number; missingCells: number; invalidCells: number; chartCount: number; cleaningRule: string }
}

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
