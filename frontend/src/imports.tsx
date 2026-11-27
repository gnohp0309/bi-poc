import { Alert, Button, Card, Input, Table } from './components/ui/primitives'
import { ArrowLeft, ArrowUpRight, FileSpreadsheet, FileUp, History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, formatNumber, uploadCsv } from './api'
import type { FileImport } from './api'
import { Empty, SectionTitle } from './ui'
import './imports.css'

export function ImportsPage({ canEdit, done, openDashboard }: { canEdit: boolean; done: (message: string) => void; openDashboard: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [items, setItems] = useState<FileImport[]>([])
  const [selected, setSelected] = useState<FileImport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [inspecting, setInspecting] = useState(false)

  useEffect(() => { api<FileImport[]>('/imports').then(setItems).catch(e => setError(e.message)) }, [])
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setSeconds(n => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  async function inspect(id: string) {
    setInspecting(true)
    try { setSelected(await api<FileImport>(`/imports/${id}`)); setError('') }
    catch (e) { setError((e as Error).message) }
    finally { setInspecting(false) }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!file || !canEdit) return
    setBusy(true); setSeconds(0); setError('')
    try {
      const result = await uploadCsv(file, title)
      setSelected(result); setFile(null); setTitle('')
      setItems(await api<FileImport[]>('/imports'))
      done(`Đã nhập ${formatNumber(result.row_count)} dòng và tạo dashboard.`)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!selected || !window.confirm(`Xóa file nhập “${selected.file_name}” cùng dataset và dashboard đã tạo?`)) return
    try {
      await api(`/imports/${selected.id}`, 'DELETE')
      setItems(items.filter(item => item.id !== selected.id)); setSelected(null); setError('')
      done('Đã xóa file nhập và dashboard liên quan.')
    } catch (e) { setError((e as Error).message) }
  }
  function drop(event: React.DragEvent) {
    event.preventDefault(); setDragging(false)
    if (!canEdit || busy) return
    const candidate = event.dataTransfer.files[0]
    if (!candidate) return
    if (!/\.csv$/i.test(candidate.name)) { setError('Hãy chọn một file CSV.'); return }
    setFile(candidate); setError('')
  }
  const numeric = selected?.columns?.filter(c => c.type === 'NUMERIC') || []
  return <div className="stack">
    {!selected && <div className="two-column wide-left import-workbench">
      <Card><SectionTitle label="Tải file CSV" icon={FileUp} />
        <form onSubmit={submit} className="import-form">
          <label className={`csv-dropzone${dragging ? ' is-dragging' : ''}${!canEdit || busy ? ' is-disabled' : ''}`}
            onDragOver={e => { e.preventDefault(); if (canEdit && !busy) setDragging(true) }} onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
            }} onDrop={drop}>
            <span className="screen-icon"><FileSpreadsheet size={24} aria-hidden="true" /></span>
            <strong>{file?.name || 'Chọn file CSV'}</strong>
            <span>CSV UTF-8 có hàng tiêu đề · Tối đa 200 MB, 1.000.000 dòng, 32 cột</span>
            <span className="file-picker-label">{file ? 'Đổi file' : 'Chọn file'}</span>
            <Input type="file" aria-label="File dữ liệu CSV" accept=".csv,text/csv" disabled={!canEdit || busy}
              onChange={e => { setFile(e.target.files?.[0] || null); setError('') }} />
          </label>
          <label>Tên phân tích (tùy chọn)<Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ví dụ: Doanh thu quý I" maxLength={120} disabled={!canEdit || busy} /></label>
          <div className="actions"><Button className="primary-button" disabled={!file || !canEdit || busy}>{busy ? `Đang nhập và phân tích · ${seconds}s` : 'Nhập file và tạo dashboard ↗'}</Button></div>
          {busy && <p role="status">Hệ thống đang nhập CSV và tính số liệu…</p>}
        </form>
        <p className="hint">CSV dùng dấu phẩy; ngày theo YYYY-MM-DD; số dùng dấu chấm thập phân. Kiểu cột được suy ra từ 200 dòng đầu. Ô không hợp lệ được chuyển thành NULL và báo trong kết quả.</p>
      </Card>
      <Card className="import-history"><SectionTitle label="Các lần nhập gần đây" count={items.length} icon={History} />{items.length ? items.map(item => <Button variant="plain" key={item.id} disabled={inspecting || busy} className="list-row clickable" onClick={() => inspect(item.id)}><span><strong>{item.file_name}</strong><small>{formatNumber(item.row_count)} dòng · {new Date(item.created_at).toLocaleString('vi-VN')}</small></span><ArrowUpRight size={15} aria-hidden="true" /></Button>) : <Empty title="Chưa có file" text="Nhập một file CSV để xem bản phân tích." />}
        {inspecting && <p role="status">Đang tải kết quả nhập…</p>}
      </Card>
    </div>}
    {error && <Alert role="alert" tone="danger">{error}</Alert>}
    {selected && <>
      <div className="subview-heading"><div><h2>Kết quả nhập dữ liệu</h2><p>{selected.file_name}</p></div>
        <Button variant="outline" onClick={() => { setSelected(null); setError('') }}><ArrowLeft size={16} aria-hidden="true" /> Quay lại tải file</Button>
      </div>
      <div className="import-summary"><div className="metric-tile"><span>Số dòng đã nhập</span><strong>{formatNumber(selected.row_count)}</strong><small>Giữ nguyên số dòng dữ liệu</small></div><div className="metric-tile"><span>Ô trống</span><strong>{formatNumber(selected.missing_count)}</strong><small>Chuyển thành NULL</small></div><div className="metric-tile"><span>Ô sai kiểu</span><strong>{formatNumber(selected.invalid_count)}</strong><small>Chuyển thành NULL</small></div><div className="metric-tile"><span>Biểu đồ tạo tự động</span><strong>{formatNumber(selected.analysis?.chartCount)}</strong><small>Gắn vào dashboard</small></div></div>
      <Card className="import-result"><div className="import-result-head"><div><h2>Kết quả phân tích</h2><p className="muted">{selected.analysis?.cleaningRule}</p></div><div className="actions"><Button className="primary-button" onClick={() => openDashboard(selected.dashboard_id)}>Mở dashboard ↗</Button>{canEdit && <Button variant="destructive" size="sm" className="danger-link" onClick={remove}>Xóa lần nhập</Button>}</div></div>
        {numeric.length > 0 && <div className="import-stat-grid">{numeric.map(c => <div className="import-stat" key={c.name}><span>{c.original}</span><strong>{formatNumber(c.sum)}</strong><small>Tổng · Trung bình {formatNumber(c.average)} · {formatNumber(c.validCount)} giá trị hợp lệ</small></div>)}</div>}
        <div className="table-scroll"><Table><thead><tr><th>Cột gốc</th><th>Cột dữ liệu</th><th>Kiểu</th><th>Ô trống</th><th>Sai kiểu</th><th>Ví dụ lỗi</th></tr></thead><tbody>{selected.columns?.map(c => <tr key={c.name}><td>{c.original}</td><td>{c.name}</td><td>{c.type}</td><td>{formatNumber(c.missing)}</td><td>{formatNumber(c.invalid)}</td><td>{c.invalidExamples.join('; ') || '—'}</td></tr>)}</tbody></Table></div>
      </Card></>}
  </div>
}
