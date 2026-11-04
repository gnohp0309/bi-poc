import { useEffect, useState } from 'react'
import { api } from './api'
import type { Dataset } from './api'
import { SectionTitle } from './ui'

type Field = { key: string; label: string; kind: string }
type Template = { id: string; name: string; description: string; fields: Field[] }
type Column = { name: string; type: string; kind: string }

export function DashboardTemplateForm({ datasets, canEdit, created }: {
  datasets: Dataset[]; canEdit: boolean; created: (id: string) => void
}) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [columns, setColumns] = useState<Column[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [name, setName] = useState('Tổng quan doanh thu')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const template = templates.find(t => t.id === templateId)

  useEffect(() => {
    let active = true
    api<Template[]>('/dashboard-templates').then(items => {
      if (active) { setTemplates(items); setTemplateId(items[0]?.id || '') }
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    setColumns([]); setMapping({}); setError(''); setLoading(!!datasetId)
    if (datasetId) api<Column[]>(`/datasets/${datasetId}/columns`).then(items => {
      if (active) setColumns(items)
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [datasetId])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canEdit || busy) return
    setBusy(true); setError('')
    try {
      const result = await api<{ dashboardId: string }>('/dashboards/from-template', 'POST', { datasetId, templateId, name, mapping })
      created(result.dashboardId)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="surface">
    <SectionTitle label="Tạo dashboard từ mẫu" />
    <form onSubmit={submit}>
      <fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid">
          <label>Mẫu dashboard<select value={templateId} onChange={e => { setTemplateId(e.target.value); setMapping({}); setName(templates.find(t => t.id === e.target.value)?.name || ''); setError('') }} required>
            <option value="">Chọn mẫu</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
          <label>Dataset<select value={datasetId} onChange={e => setDatasetId(e.target.value)} required>
            <option value="">Chọn dataset</option>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
          <label className="wide">Tên dashboard<input value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></label>
        </div>
        {template && <p className="muted">{template.description}</p>}
        {loading && <p role="status">Đang tải cấu trúc dataset…</p>}
        {datasetId && !loading && <div className="form-grid">{template?.fields.map(field => <label key={field.key}>
          {field.label} ({field.kind === 'date' ? 'ngày' : field.kind === 'number' ? 'số' : 'văn bản'})
          <select value={mapping[field.key] || ''} onChange={e => setMapping({ ...mapping, [field.key]: e.target.value })} required>
            <option value="">Chọn cột</option>{columns.filter(c => c.kind === field.kind).map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
          </select>
          {!columns.some(c => c.kind === field.kind) && <span>Dataset không có cột phù hợp cho trường này.</span>}
        </label>)}</div>}
        <p className="hint">{templateId === 'order-status' && 'Ngày trống được loại khỏi biểu đồ số đơn theo tháng, nhưng dòng đó vẫn được đếm theo trạng thái. '}{templateId === 'sales-overview' && 'Ngày trống được loại khỏi biểu đồ theo tháng. Doanh thu của các dòng đó vẫn có thể nằm trong biểu đồ theo vùng và danh mục. '}Mỗi biểu đồ hiển thị tối đa 100 nhóm.</p>
        <div className="actions"><button className="primary-button" disabled={busy || loading || !name.trim() || !datasetId || !template || !template.fields.every(f => mapping[f.key])}>
          {busy ? 'Đang tạo dashboard…' : 'Tạo dashboard từ mẫu'}
        </button></div>
      </fieldset>
    </form>
    {!datasets.length && <p className="hint">Tạo dataset hoặc nhập CSV trước khi sử dụng mẫu.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
