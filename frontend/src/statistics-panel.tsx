import { useEffect, useState } from 'react'
import { api } from './api'
import { ChatResult } from './chat-result'
import type { ColumnProfile } from './exploration-api'

const operations = [
  ['descriptive', 'Thống kê mô tả'], ['correlation', 'Tương quan'], ['outlier', 'Phát hiện ngoại lệ'],
  ['shapiro_wilk', 'Shapiro–Wilk'], ['independent_ttest', 'Independent T-test'], ['paired_ttest', 'Paired T-test'],
  ['anova', 'ANOVA'], ['chi_square', 'Chi-square'], ['mann_whitney', 'Mann–Whitney U'], ['kruskal_wallis', 'Kruskal–Wallis'],
]
export function StatisticsPanel({ datasetId, columns, canEdit }: { datasetId: string; columns: ColumnProfile[]; canEdit: boolean }) {
  const numeric = columns.filter(c => c.kind === 'number')
  const [operation, setOperation] = useState('descriptive')
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [group, setGroup] = useState('')
  const [groups, setGroups] = useState('')
  const [method, setMethod] = useState('pearson')
  const [alpha, setAlpha] = useState('0.05')
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setFirst(numeric[0]?.name || ''); setSecond(numeric[1]?.name || ''); setGroup(columns.find(c => c.kind === 'text')?.name || ''); setResult(null); setError('') }, [datasetId, columns])
  const grouped = ['independent_ttest', 'anova', 'mann_whitney', 'kruskal_wallis'].includes(operation)
  const pair = ['correlation', 'paired_ttest', 'chi_square'].includes(operation)
  const choices = operation === 'chi_square' ? columns : numeric
  async function run() {
    setBusy(true); setError(''); setResult(null)
    const body: Record<string, unknown> = { operation }
    if (operation === 'descriptive') body.columns = [first]
    else if (operation === 'correlation') { body.columns = [first, second]; body.method = method }
    else if (operation === 'outlier') { body.column = first; body.method = method }
    else if (operation === 'shapiro_wilk') body.column = first
    else if (operation === 'paired_ttest') { body.column_before = first; body.column_after = second }
    else if (operation === 'chi_square') { body.column1 = first; body.column2 = second }
    else { body.value_column = first; body.group_column = group; if (groups.trim()) body.group_values = groups.split(',').map(x => x.trim()).filter(Boolean).map(x => columns.find(c => c.name === group)?.kind === 'number' ? Number(x) : columns.find(c => c.name === group)?.kind === 'boolean' ? x === 'true' : x) }
    if (operation === 'independent_ttest') body.equal_variance = false
    if (!['descriptive', 'correlation', 'outlier'].includes(operation)) body.alpha = Number(alpha)
    try { setResult(await api(`/datasets/${datasetId}/statistics`, 'POST', body)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Không chạy được thống kê') }
    finally { setBusy(false) }
  }
  return <section className="surface">
    <h2>Phân tích nâng cao</h2>
    <p>Engine SciPy tính từ dữ liệu thật của dataset, không gọi Gemini. Không tự lấy mẫu hoặc sửa dữ liệu.</p>
    <div className="form-grid">
      <label>Phương pháp phân tích<select value={operation} onChange={e => { setOperation(e.target.value); setMethod(e.target.value === 'outlier' ? 'iqr' : 'pearson'); setResult(null); setFirst(numeric[0]?.name || columns[0]?.name || ''); setSecond(numeric[1]?.name || columns[1]?.name || '') }}>{operations.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label>{operation === 'paired_ttest' ? 'Cột trước' : 'Cột phân tích'}<select value={first} onChange={e => setFirst(e.target.value)}><option value="">Chọn cột</option>{choices.map(c => <option key={c.name} value={c.name}>{c.label} ({c.name})</option>)}</select></label>
      {pair && <label>{operation === 'paired_ttest' ? 'Cột sau' : 'Cột thứ hai'}<select value={second} onChange={e => setSecond(e.target.value)}><option value="">Chọn cột</option>{choices.map(c => <option key={c.name} value={c.name}>{c.label} ({c.name})</option>)}</select></label>}
      {grouped && <><label>Cột phân nhóm<select value={group} onChange={e => setGroup(e.target.value)}><option value="">Chọn cột</option>{columns.map(c => <option key={c.name} value={c.name}>{c.label} ({c.name})</option>)}</select></label><label>Nhóm cần so sánh tùy chọn<input value={groups} onChange={e => setGroups(e.target.value)} placeholder="Ví dụ: A, B; để trống dùng mọi nhóm" /></label></>}
      {operation === 'correlation' && <label>Loại tương quan<select value={method} onChange={e => setMethod(e.target.value)}><option value="pearson">Pearson</option><option value="spearman">Spearman</option></select></label>}
      {operation === 'outlier' && <label>Phương pháp ngoại lệ<select value={method} onChange={e => setMethod(e.target.value)}><option value="iqr">IQR</option><option value="zscore">Z-score</option></select></label>}
      {!['descriptive', 'correlation', 'outlier'].includes(operation) && <label>Mức ý nghĩa alpha<input type="number" min="0.01" max="0.1" step="0.01" value={alpha} onChange={e => setAlpha(e.target.value)} /></label>}
    </div>
    <p className="hint">T-test độc lập dùng Welch. Paired T-test cần mỗi dòng là cùng một đối tượng trước/sau. Tính độc lập không được tự suy ra từ dữ liệu. Shapiro–Wilk giới hạn 3–5000 quan sát.</p>
    <button className="primary-button" disabled={busy || !canEdit || !first || (pair && !second) || (grouped && !group)} onClick={run}>{busy ? 'Đang chạy engine thống kê…' : 'Chạy phân tích thống kê'}</button>
    {!canEdit && <p>Viewer chỉ xem báo cáo; cần Analyst hoặc Admin để chạy phân tích.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {result !== null && <ChatResult metadataJson={JSON.stringify({ analysis_result: result })} content="" openDashboard={() => {}} />}
  </section>
}
