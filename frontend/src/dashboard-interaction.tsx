import { Button, Card, Input, NativeSelect, SurfaceDialog } from './components/ui/primitives'
import { useEffect, useState } from 'react'
import { api } from './api'
import type { ChartData, QueryResult } from './api'
import { DataTable } from './ui'
export type DashboardFilter = { datasetId: string; column: string; op: 'eq' | 'date' | 'null'; value: string; end: string }
type Source = { id: string; name: string; columns: { name: string; kind: string }[] }
export function DashboardFilters({ id, disabled, onApply, onRefresh, refreshedAt, initialFilters }: { initialFilters: DashboardFilter[]; id: string; disabled: boolean; onApply: (filters: DashboardFilter[]) => Promise<void>; onRefresh: () => Promise<void>; refreshedAt: string }) {
  const [sources, setSources] = useState<Source[]>([])
  const [filters, setFilters] = useState<DashboardFilter[]>(initialFilters)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; setFilters(initialFilters); setSources([]); setError(''); api<{ datasets: Source[] }>(`/dashboards/${id}/filters`).then(r => { if (active) setSources(r.datasets) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [id])
  function update(index: number, patch: Partial<DashboardFilter>) { setFilters(values => values.map((f, i) => i === index ? { ...f, ...patch } : f)) }
  async function run(action: () => Promise<void>) { setError(''); try { await action() } catch (e) { setError((e as Error).message) } }
  return <Card><h2>Bộ lọc dashboard</h2><p className="hint">Chọn cột thời gian, khu vực hoặc danh mục thật. Các điều kiện kết hợp bằng AND, áp dụng cho mọi biểu đồ thuộc dataset đã chọn; nguồn khác giữ nguyên. Ngày kết thúc được tính cả ngày, múi giờ UTC.</p>
    <form onSubmit={e => { e.preventDefault(); run(() => onApply(filters)) }}><fieldset disabled={disabled} style={{ border: 0, padding: 0 }}>
      {filters.map((f, i) => <div className="inline-form" key={i} style={{ marginBottom: 12 }}>
        <label>Dataset<NativeSelect value={f.datasetId} onChange={e => update(i, { datasetId: e.target.value, column: '', op: 'eq' })}>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label>
        <label>Cột lọc<NativeSelect required value={f.column} onChange={e => update(i, { column: e.target.value, op: 'eq' })}><option value="">Chọn cột</option>{sources.find(s => s.id === f.datasetId)?.columns.map(c => <option key={c.name}>{c.name}</option>)}</NativeSelect></label>
        <label>Điều kiện<NativeSelect value={f.op} onChange={e => update(i, { op: e.target.value as DashboardFilter['op'] })}><option value="eq">Bằng giá trị</option><option value="null">Dữ liệu trống (NULL)</option>{sources.find(s => s.id === f.datasetId)?.columns.find(c => c.name === f.column)?.kind === 'date' && <option value="date">Khoảng ngày</option>}</NativeSelect></label>
        {f.op !== 'null' && <label>{f.op === 'date' ? 'Từ ngày' : 'Giá trị'}<Input required maxLength={1000} type={f.op === 'date' ? 'date' : 'text'} value={f.value} onChange={e => update(i, { value: e.target.value })} /></label>}
        {f.op === 'date' && <label>Đến ngày<Input required type="date" min={f.value} value={f.end} onChange={e => update(i, { end: e.target.value })} /></label>}
        <Button variant="destructive" size="sm" type="button" className="danger-link" onClick={() => setFilters(values => values.filter((_, j) => j !== i))}>Bỏ điều kiện</Button>
      </div>)}
      <div className="actions"><Button variant="outline" type="button" className="secondary-button" disabled={!sources.length || filters.length >= 12} onClick={() => setFilters(values => [...values, { datasetId: sources[0].id, column: '', op: 'eq', value: '', end: '' }])}>Thêm điều kiện</Button><Button className="primary-button">Áp dụng bộ lọc</Button><Button variant="outline" type="button" className="secondary-button" onClick={() => run(async () => { await onApply([]); setFilters([]) })}>Xóa bộ lọc</Button><Button variant="outline" type="button" className="secondary-button" onClick={() => run(onRefresh)}>Làm mới dữ liệu</Button></div>
    </fieldset></form>{refreshedAt && <p className="hint">Đã cập nhật: {new Date(refreshedAt).toLocaleString('vi-VN')}. Làm mới dùng bộ lọc đã áp dụng, giữ cấu hình và bố cục.</p>}{error && <p role="alert" className="form-error">{error}</p>}
  </Card>
}
export function DashboardDrill({ id, chart, filters, initialIndex, onClose }: { id: string; chart: ChartData; filters: DashboardFilter[]; initialIndex?: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex ?? 0)
  const [result, setResult] = useState<(QueryResult & { note: string }) | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  useEffect(() => { let active = true; setLoading(true); setResult(null); setError(''); setPage(0)
    api<QueryResult & { note: string }>(`/dashboards/${id}/charts/${chart.id}/drill`, 'POST', { filters, rowIndex: index, rowKey: chart.rowKeys?.[index] }).then(value => { if (active) setResult(value) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false }
  }, [id, chart, filters, index])
  return <SurfaceDialog title="Dữ liệu chi tiết" description={chart.name} onClose={onClose} className="dashboard-drill-dialog">
    {chart.chartType !== 'kpi' && <label>Nhóm / điểm dữ liệu<NativeSelect value={index} onChange={e => setIndex(Number(e.target.value))}>{chart.rows.map((row, i) => <option key={i} value={i}>{i + 1}. {Object.entries(row).map(([k, v]) => `${k}: ${String(v ?? 'NULL')}`).join(' · ')}</option>)}</NativeSelect></label>}
    {loading && <p role="status">Đang truy vấn dữ liệu chi tiết…</p>}{error && <p role="alert" className="form-error">{error}</p>}{result && <><p className="hint">{result.note}</p><DataTable result={{ ...result, rows: result.rows.slice(page * 25, (page + 1) * 25) }} max={25} /><div className="actions"><Button variant="outline" className="secondary-button" disabled={!page} onClick={() => setPage(p => p - 1)}>Trang trước</Button><span>Trang {page + 1} / {Math.max(1, Math.ceil(result.rows.length / 25))} · {result.rows.length} dòng{result.truncated ? ' (đã giới hạn)' : ''}</span><Button variant="outline" className="secondary-button" disabled={(page + 1) * 25 >= result.rows.length} onClick={() => setPage(p => p + 1)}>Trang sau</Button></div></>}
  </SurfaceDialog>
}
