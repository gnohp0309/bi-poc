import { useEffect, useState } from 'react'
import { api } from './api'
import type { Chart, ChartData, ChartType, Dataset, ChartDefinition } from './api'
import { getDatasetMetadata } from './analysis-api'
import type { DatasetMetadata } from './analysis-api'
import { ChartCanvas, Empty, SectionTitle } from './ui'

const types: [ChartType, string][] = [
  ['bar', 'Cột'], ['line', 'Đường'], ['pie', 'Tròn'], ['donut', 'Donut'], ['kpi', 'KPI card'],
  ['histogram', 'Histogram — phân phối'], ['scatter', 'Scatter — hai biến'], ['heatmap', 'Heatmap — tương quan Pearson'],
  ['map', 'Bản đồ điểm'], ['stacked-bar', 'Cột chồng'], ['stacked-area', 'Miền chồng theo thời gian'],
]
export function ChartsPage({ datasets, charts, done, canEdit = true, editSpec, dashboardId, onSaved, onCancel, onBusyChange }: {
  datasets: Dataset[]; charts: Chart[]; done: (message: string) => void; canEdit?: boolean
  editSpec?: ChartDefinition; dashboardId?: string; onSaved?: (copied: boolean) => void | Promise<void>; onCancel?: () => void; onBusyChange?: (busy: boolean) => void
}) {
  const [datasetId, setDatasetId] = useState(editSpec?.datasetId || '')
  const [name, setName] = useState(editSpec?.name || '')
  const [chartType, setChartType] = useState<ChartType>(editSpec?.chartType || 'bar')
  const [dimension, setDimension] = useState('')
  const [metric, setMetric] = useState('')
  const [aggregate, setAggregate] = useState<'count' | 'sum' | 'avg'>('sum')
  const [metadata, setMetadata] = useState<DatasetMetadata | null>(null)
  const [preview, setPreview] = useState<ChartData | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [seriesDimension, setSeriesDimension] = useState('')
  const [numericColumns, setNumericColumns] = useState<string[]>([])
  const [binCount, setBinCount] = useState(10)
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [labelColumn, setLabelColumn] = useState('')
  const [timeGrain, setTimeGrain] = useState('')
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  useEffect(() => { if (!datasets.some(d => d.id === datasetId)) setDatasetId(datasets[0]?.id || '') }, [datasetId, datasets])
  useEffect(() => {
    let active = true
    setMetadata(null); setDimension(''); setMetric(''); setPreview(null); setSeriesDimension(''); setNumericColumns([]); setLatitude(''); setLongitude(''); setLabelColumn(''); setStatus(''); setTimeGrain(''); setLoading(!!datasetId)
    if (datasetId) getDatasetMetadata(datasetId).then(value => { if (active) {
      setMetadata(value)
      if (editSpec && editSpec.datasetId === datasetId) {
        setDimension(editSpec.dimension || ''); setMetric(editSpec.metric || ''); setAggregate(editSpec.aggregate)
        setSeriesDimension(editSpec.seriesDimension || ''); setNumericColumns(editSpec.numericColumns || []); setBinCount(editSpec.binCount || 10)
        setLatitude(editSpec.latitude || ''); setLongitude(editSpec.longitude || ''); setLabelColumn(editSpec.labelColumn || ''); setTimeGrain(editSpec.timeGrain || '')
      }
    } })
      .catch(e => { if (active) setStatus(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [datasetId, editSpec])
  const columns = metadata?.columns || []
  const numbers = columns.filter(c => c.kind === 'number')
  const scalar = columns.filter(c => c.kind !== 'other')
  const stacked = chartType.startsWith('stacked-')
  const hasDimension = ['bar', 'line', 'pie', 'donut', 'scatter', 'stacked-bar', 'stacked-area'].includes(chartType)
  const dimensions = chartType === 'scatter' ? numbers : chartType === 'stacked-area' ? columns.filter(c => c.kind === 'date') : scalar
  const fixedCount = ['histogram', 'heatmap'].includes(chartType)
  const hasAggregate = !['scatter', 'histogram', 'heatmap'].includes(chartType)
  const effectiveAggregate = fixedCount ? 'count' : aggregate
  const metricChoices = chartType === 'histogram' || chartType === 'scatter' || effectiveAggregate !== 'count' ? numbers : scalar
  const allowStar = !['histogram', 'scatter', 'heatmap'].includes(chartType) && effectiveAggregate === 'count'
  const spec = {
    datasetId, name, chartType, dimension: hasDimension ? dimension : '', metric: chartType === 'heatmap' ? '' : metric, aggregate: effectiveAggregate,
    ...(stacked ? { seriesDimension } : {}), ...(chartType === 'heatmap' ? { numericColumns } : {}),
    ...(chartType === 'histogram' ? { binCount } : {}), ...(chartType === 'map' ? { latitude, longitude, labelColumn } : {}),
    ...(timeGrain && (stacked || chartType === 'line') ? { timeGrain } : {}),
  }
  const key = JSON.stringify(spec)
  useEffect(() => { setPreview(null) }, [key])
  const ready = !!datasetId && !loading && !!metadata && (!hasDimension || dimensions.some(c => c.name === dimension)) &&
    (chartType === 'heatmap' ? numericColumns.length >= 2 && numericColumns.length <= 8 : allowStar && metric === '*' || metricChoices.some(c => c.name === metric)) &&
    (!stacked || scalar.some(c => c.name === seriesDimension)) && (chartType !== 'map' || numbers.some(c => c.name === latitude) && numbers.some(c => c.name === longitude)) &&
    (chartType !== 'histogram' || Number.isInteger(binCount) && binCount >= 2 && binCount <= 50)
  async function show() {
    if (!ready || busy) return
    setBusy(true); setStatus('')
    try { setPreview(await api<ChartData>('/charts/preview', 'POST', spec)) } catch (e) { setStatus((e as Error).message) }
    finally { setBusy(false) }
  }
  async function save() {
    if (!ready || busy || !canEdit) return
    setBusy(true); setStatus('')
    try {
      if (editSpec && dashboardId) {
        const response = await api<{ chartId: string; copied: boolean }>(`/dashboards/${dashboardId}/charts/${editSpec.id}`, 'PUT', spec)
        await onSaved?.(response.copied)
      } else {
        await api('/charts', 'POST', spec); done('Đã lưu biểu đồ. Có thể thêm vào dashboard.'); setPreview(await api('/charts/preview', 'POST', spec))
      }
    }
    catch (e) { setStatus((e as Error).message) } finally { setBusy(false) }
  }
  async function remove(item: Chart) {
    if (!canEdit || !window.confirm(`Xóa biểu đồ “${item.name}”?`)) return
    try { await api(`/charts/${item.id}`, 'DELETE'); done('Đã xóa biểu đồ.') } catch (e) { setStatus((e as Error).message) }
  }
  const options = (items: typeof columns) => items.map(c => <option key={c.name} value={c.name}>{c.label} ({c.name}) · {c.type}</option>)
  return <div className="stack"><div className="two-column">
    <section className="surface"><SectionTitle label="Cấu hình biểu đồ" />
      <fieldset disabled={busy || loading} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="form-grid">
        <label className="wide">Dataset<select disabled={!!editSpec} value={datasetId} onChange={e => setDatasetId(e.target.value)}><option value="">Chọn dataset</option>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="wide">Tên biểu đồ<input autoFocus={!!editSpec} value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
        <label className="wide">Dạng biểu đồ<select value={chartType} onChange={e => { setChartType(e.target.value as ChartType); setDimension(''); setMetric(''); setTimeGrain(''); setStatus('') }}>{types.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {hasDimension && <label>{chartType === 'scatter' ? 'Trục X (số)' : 'Chiều dữ liệu / trục X'}<select value={dimension} onChange={e => setDimension(e.target.value)}><option value="">Chọn cột</option>{options(dimensions)}</select>{!loading && !dimensions.length && <span>Không có cột đúng kiểu.</span>}</label>}
        {hasAggregate && <label>Phép tổng hợp<select value={aggregate} onChange={e => { setAggregate(e.target.value as typeof aggregate); setMetric('') }}><option value="sum">Tổng</option><option value="count">Đếm</option><option value="avg">Trung bình</option></select></label>}
        {chartType !== 'heatmap' && <label>{chartType === 'scatter' ? 'Trục Y (số)' : chartType === 'histogram' ? 'Cột số cần phân phối' : 'Cột chỉ số'}<select value={metric} onChange={e => setMetric(e.target.value)}><option value="">Chọn cột</option>{allowStar && <option value="*">* · Số dòng</option>}{options(metricChoices)}</select></label>}
        {(stacked || chartType === 'line') && columns.find(c => c.name === dimension)?.kind === 'date' && <label>Nhóm thời gian<select value={timeGrain} onChange={e => setTimeGrain(e.target.value)}><option value="">Giá trị gốc</option><option value="month">Theo tháng (UTC)</option></select></label>}
        {stacked && <label>Nhóm chuỗi (màu)<select value={seriesDimension} onChange={e => setSeriesDimension(e.target.value)}><option value="">Chọn cột</option>{options(scalar)}</select></label>}
        {chartType === 'histogram' && <label>Số khoảng (2–50)<input type="number" min={2} max={50} step={1} value={binCount} onChange={e => setBinCount(Number(e.target.value))} /></label>}
        {chartType === 'heatmap' && <label className="wide">Các cột số (chọn 2–8 cột)<select multiple size={Math.min(8, Math.max(3, numbers.length))} value={numericColumns} onChange={e => setNumericColumns(Array.from(e.target.selectedOptions).map(o => o.value))}>{options(numbers)}</select><span>Giữ Ctrl/Cmd để chọn nhiều cột. Cần ít nhất hai cột số.</span></label>}
        {chartType === 'map' && <><label>Vĩ độ<select value={latitude} onChange={e => setLatitude(e.target.value)}><option value="">Chọn cột</option>{options(numbers)}</select></label><label>Kinh độ<select value={longitude} onChange={e => setLongitude(e.target.value)}><option value="">Chọn cột</option>{options(numbers)}</select></label><label className="wide">Nhãn địa điểm (tùy chọn)<select value={labelColumn} onChange={e => setLabelColumn(e.target.value)}><option value="">Không có</option>{options(scalar)}</select></label><p className="chart-field-note wide">Cần cột tọa độ thực; tên vùng đơn lẻ không tự chuyển thành vị trí.</p></>}
      </div></fieldset>
      {loading && <p role="status">Đang tải cấu trúc dataset…</p>}
      {status && <p className="form-error" role="alert">{status}</p>}
      <div className="actions"><button className="secondary-button" disabled={!ready || busy} onClick={show}>{busy ? 'Đang xử lý…' : 'Xem trước'}</button><button className="primary-button" disabled={!ready || busy || !canEdit || !name.trim()} onClick={save}>{editSpec ? 'Lưu thay đổi' : 'Lưu biểu đồ'}</button>{onCancel && <button className="secondary-button" disabled={busy} onClick={onCancel}>Hủy</button>}</div>
    </section>
    <section className="surface chart-preview"><SectionTitle label="Xem trước trực quan" />{preview ? <ChartCanvas data={{ ...preview, name: name || 'Bản xem trước' }} /> : <Empty title="Chưa có bản xem" text="Chọn dạng biểu đồ và các cột phù hợp rồi bấm Xem trước." />}</section>
  </div>{!editSpec && <section className="surface"><SectionTitle label="Biểu đồ đã lưu" count={charts.length} /><div className="item-grid">{charts.map(item => <div className="item-card" key={item.id}><span className="tag">{types.find(t => t[0] === item.chart_type)?.[1] || item.chart_type}</span><h3>{item.name}</h3><p>{item.dataset_name}</p><small>{item.metric && `${item.aggregate.toUpperCase()}(${item.metric})`}{item.dimension && ` · ${item.dimension}`}</small><button className="danger-link" disabled={!canEdit} onClick={() => remove(item)}>Xóa biểu đồ</button></div>)}</div></section>}</div>
}
