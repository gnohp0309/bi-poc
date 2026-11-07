import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import type { ChartData, Dataset } from './api'
import { SectionTitle } from './ui'
import { DashboardGrid } from './dashboard-grid'
import { fieldProblem, suggestMapping } from './template-mapping'
import type { TemplateField, TemplateColumn } from './template-mapping'

type Template = { id: string; name: string; description: string; fields: TemplateField[]; charts: { name: string; chartType: string; aggregate: string }[] }
type Preview = { eligible: boolean; issues: { field: string; message: string }[]; warnings: string[]; charts: ChartData[] }

export function DashboardTemplateForm({ datasets, canEdit, created }: { datasets: Dataset[]; canEdit: boolean; created: (id: string) => void }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [columns, setColumns] = useState<TemplateColumn[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [name, setName] = useState('Tổng quan doanh thu')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const sequence = useRef(0)
  const template = templates.find(t => t.id === templateId)
  const problems = template?.fields.map(f => fieldProblem(f, columns, mapping)).filter(Boolean) || []
  useEffect(() => { let active = true; api<Template[]>('/dashboard-templates').then(items => {
    if (active) { setTemplates(items); setTemplateId(items[0]?.id || ''); setName(items[0]?.name || '') }
  }).catch(e => { if (active) setError(e.message) }); return () => { active = false; sequence.current++ } }, [])
  useEffect(() => {
    let active = true
    sequence.current++; setColumns([]); setMapping({}); setPreview(null); setError(''); setChecking(false); setLoading(!!datasetId)
    if (datasetId) api<TemplateColumn[]>(`/datasets/${datasetId}/columns`).then(items => { if (active) setColumns(items) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [datasetId])
  useEffect(() => { setMapping(template ? suggestMapping(template.fields, columns) : {}); invalidate() }, [templateId, columns])
  function invalidate() { sequence.current++; setPreview(null); setChecking(false); setError('') }
  async function check() {
    const token = ++sequence.current; setChecking(true); setError(''); setPreview(null)
    try { const report = await api<Preview>(`/dashboard-templates/${templateId}/preview`, 'POST', { datasetId, mapping }); if (token === sequence.current) setPreview(report) }
    catch (e) { if (token === sequence.current) setError((e as Error).message) }
    finally { if (token === sequence.current) setChecking(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canEdit || busy || checking || !preview?.eligible || problems.length) return
    setBusy(true); setError('')
    try { const result = await api<{ dashboardId: string }>('/dashboards/from-template', 'POST', { datasetId, templateId, name, mapping }); created(result.dashboardId); setPreview(null) }
    catch (e) { setError((e as Error).message); setPreview(null) }
    finally { setBusy(false) }
  }
  return <section className="surface dashboard-template-form">
    <SectionTitle label="Tạo dashboard từ mẫu" />
    <form onSubmit={submit}><fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="form-grid">
        <label>Mẫu dashboard<select value={templateId} onChange={e => { invalidate(); setTemplateId(e.target.value); setName(templates.find(t => t.id === e.target.value)?.name || '') }} required><option value="">Chọn mẫu</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Dataset<select value={datasetId} onChange={e => { invalidate(); setDatasetId(e.target.value) }} required><option value="">Chọn dataset</option>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="wide">Tên dashboard<input value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></label>
      </div>
      {template && <><p className="muted">{template.description}</p><ul className="hint">{template.charts.map((c, i) => <li key={i}>{c.name} · {c.chartType} / {c.aggregate.toUpperCase()}</li>)}</ul></>}
      {loading && <p role="status">Đang tải cấu trúc dataset…</p>}
      {datasetId && !loading && <><p className="hint">Cột được gợi ý khi tên và kiểu phù hợp duy nhất. Hãy xác nhận ý nghĩa từng trường; tên khác vẫn có thể chọn thủ công. Hệ thống không tự đổi tên hay sửa dữ liệu gốc.</p><div className="form-grid">{template?.fields.map(field => <label key={field.key}>{field.label} ({field.kind === 'date' ? 'ngày' : field.kind === 'number' ? 'số' : 'văn bản'})
        <select value={mapping[field.key] || ''} onChange={e => { invalidate(); setMapping(m => ({ ...m, [field.key]: e.target.value })) }} required><option value="">Chọn cột</option>{columns.filter(c => c.kind === field.kind).map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}</select>
        {fieldProblem(field, columns, mapping) && <span className="form-error">{fieldProblem(field, columns, mapping)}</span>}
      </label>)}</div></>}
      <p className="hint">Mỗi biểu đồ hiển thị tối đa 100 nhóm. Kiểm tra và xem trước dữ liệu thật trước khi tạo. Ngày/tháng dùng UTC với timestamp có múi giờ.</p>
      <div className="actions"><button type="button" className="secondary-button" disabled={loading || checking || !datasetId || !template || problems.length > 0} onClick={check}>{checking ? 'Đang kiểm tra…' : 'Kiểm tra & xem trước'}</button><button className="primary-button" disabled={busy || loading || checking || !name.trim() || !datasetId || !preview?.eligible || problems.length > 0}>{busy ? 'Đang tạo dashboard…' : 'Tạo dashboard từ mẫu'}</button></div>
    </fieldset></form>
    {!datasets.length && <p className="hint">Tạo dataset hoặc nhập CSV trước khi sử dụng mẫu.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <div className="stack" style={{ marginTop: 18 }}><p role="status">{preview.eligible ? 'Ánh xạ hợp lệ. Xem số liệu, bố cục và các lưu ý trước khi tạo.' : 'Chưa thể tạo template với dữ liệu đã chọn.'}</p>
      {!!preview.issues.length && <ul className="form-error" role="alert">{preview.issues.map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
      {!!preview.warnings.length && <div className="surface"><strong>Lưu ý dữ liệu</strong><ul>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      {!!preview.charts.length && <DashboardGrid charts={preview.charts} />}
    </div>}
  </section>
}
