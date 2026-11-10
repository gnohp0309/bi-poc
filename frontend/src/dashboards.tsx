import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { api } from './api'
import type { Chart, ChartDefinition, Dashboard, DashboardDetail, Dataset } from './api'
import { Empty, SectionTitle } from './ui'
import { DashboardTemplateForm } from './dashboard-templates'
import { DashboardGrid } from './dashboard-grid'
import { appendItem, ordered, readLayout } from './dashboard-layout'
import type { GridItem } from './dashboard-layout'
import { ChartsPage } from './chart-builder'
import { DashboardFilters, DashboardDrill } from './dashboard-interaction'
import type { DashboardFilter } from './dashboard-interaction'
import type { ChartData } from './api'
import { DashboardExport, ExportContext } from './dashboard-export'
import './dashboard-export.css'

const message = (error: unknown) => error instanceof Error ? error.message : 'Thao tác không thành công'
type ChatPanelControls = { onClose: () => void; onDeleted: () => void; leaveGuard: RefObject<(() => boolean) | null> }

export function DashboardsPage({ dashboards, charts, datasets, canEdit, done, initialId = '', panel }: {
  dashboards: Dashboard[]; charts: Chart[]; datasets: Dataset[]; canEdit: boolean; done: (message: string) => void; initialId?: string
  panel?: ChatPanelControls
}) {
  const [id, setId] = useState(initialId)
  const [exporting, setExporting] = useState(false)
  const exportRoot = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [dashboardName, setDashboardName] = useState('')
  const [detail, setDetail] = useState<DashboardDetail | null>(null)
  const [chartId, setChartId] = useState('')
  const appliedFilters = useRef<DashboardFilter[]>([])
  const [refreshedAt, setRefreshedAt] = useState('')
  const [drill, setDrill] = useState<{ chart: ChartData; index?: number } | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editingLayout, setEditingLayout] = useState(false)
  const [draft, setDraft] = useState<GridItem[]>([])
  const [editSpec, setEditSpec] = useState<ChartDefinition | null>(null)
  const [creatingChart, setCreatingChart] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [refreshSeconds, setRefreshSeconds] = useState(0)
  const [autoRefreshError, setAutoRefreshError] = useState('')
  const [deletedIds, setDeletedIds] = useState<string[]>([])
  const closeButton = useRef<HTMLButtonElement>(null)
  const sequence = useRef(0)
  const selected = useRef(id)
  selected.current = id
  const availableDashboards = dashboards.filter(d => !deletedIds.includes(d.id))
  const dirty = detail && JSON.stringify(ordered(draft)) !== JSON.stringify(ordered(readLayout(detail.charts)))
  const leaveGuard = panel?.leaveGuard
  const unsaved = !!(editingLayout && dirty || editSpec || creatingChart || detail && dashboardName !== detail.name)
  useEffect(() => { closeButton.current?.focus() }, [])
  useEffect(() => {
    const canLeave = () => !busy && !editBusy && !exporting && (!unsaved || window.confirm('Bỏ các thay đổi chưa lưu?'))
    if (leaveGuard) leaveGuard.current = canLeave
    const navigate = (event: Event) => { if (!canLeave()) event.preventDefault() }
    const unload = (event: BeforeUnloadEvent) => { if (unsaved || busy || editBusy || exporting) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('bi-poc-before-navigate', navigate)
    window.addEventListener('beforeunload', unload)
    return () => { if (leaveGuard) leaveGuard.current = null; window.removeEventListener('bi-poc-before-navigate', navigate); window.removeEventListener('beforeunload', unload) }
  }, [leaveGuard, busy, editBusy, exporting, unsaved])
  useEffect(() => { if (!id && availableDashboards.length) setId(availableDashboards[0].id) }, [id, dashboards, deletedIds])
  const load = useCallback(async (value = id, filters = appliedFilters.current, automatic = false) => {
    const token = ++sequence.current
    setLoading(true)
    try {
      const result = await api<DashboardDetail & { refreshedAt: string }>(`/dashboards/${value}/query`, 'POST', { filters })
      if (token === sequence.current && value === selected.current) {
        appliedFilters.current = filters; setRefreshedAt(result.refreshedAt); setDetail(result); setDashboardName(result.name); setDraft(readLayout(result.charts))
        setAutoRefreshError('')
      }
    } catch (error) {
      if (!automatic) throw error
      if (token === sequence.current) setAutoRefreshError(message(error))
    } finally { if (token === sequence.current) setLoading(false) }
  }, [id])
  useEffect(() => {
    let active = true
    setDetail(null); setStatus(''); appliedFilters.current = []; setRefreshedAt(''); setDrill(null); setEditingLayout(false)
    if (id) load(id).catch(e => { if (active) setStatus(message(e)) })
    return () => { active = false; sequence.current++ }
  }, [id, load])
  async function mutate(action: () => Promise<void>) {
    if (!canEdit || busy) return
    setBusy(true); setStatus('')
    try { await action() } catch (e) { setStatus(message(e)) } finally { setBusy(false) }
  }
  function choose(value: string) {
    if (editingLayout && dirty && !window.confirm('Bỏ các thay đổi bố cục chưa lưu?')) return
    setEditingLayout(false); setId(value)
  }
  async function create() {
    await mutate(async () => { const result = await api<{ id: string }>('/dashboards', 'POST', { name }); setName(''); setId(result.id); done('Đã tạo dashboard.') })
  }
  async function persist(items: GridItem[]) {
    await api(`/dashboards/${id}/layout`, 'PUT', { items: ordered(items) })
    const scopes = await api<{ datasets: { id: string }[] }>(`/dashboards/${id}/filters`)
    await load(id, appliedFilters.current.filter(f => scopes.datasets.some(s => s.id === f.datasetId))); setEditingLayout(false); done('Đã lưu bố cục dashboard.')
  }
  async function add() {
    if (!detail || !chartId) return
    await mutate(async () => { await persist(appendItem(readLayout(detail.charts), chartId)); setChartId('') })
  }
  async function removeChart(value: string) {
    if (!detail) return
    await mutate(async () => persist(readLayout(detail.charts).filter(i => i.chartId !== value)))
  }
  async function rename() {
    await mutate(async () => { await api(`/dashboards/${id}`, 'PUT', { name: dashboardName }); await load(); done('Đã đổi tên dashboard.') })
  }
  async function share() {
    await mutate(async () => { await api(`/dashboards/${id}/share`, detail?.share_token ? 'DELETE' : 'POST'); await load(); done(detail?.share_token ? 'Đã tắt chia sẻ.' : 'Đã bật chia sẻ.') })
  }
  async function remove() {
    if (!detail || !window.confirm(`Xóa dashboard “${detail.name}”?`)) return
    await mutate(async () => {
      await api(`/dashboards/${id}`, 'DELETE'); setDeletedIds(items => [...items, id]); setDetail(null)
      setId(availableDashboards.find(d => d.id !== id)?.id || ''); done('Đã xóa dashboard.')
      panel?.onDeleted()
    })
  }
  async function editChart(value: string) {
    await mutate(async () => { setEditSpec(await api<ChartDefinition>(`/charts/${value}`)) })
  }
  const locked = busy || loading || editingLayout || editBusy
  const refreshPaused = locked || exporting || !!drill || !!editSpec || creatingChart || dashboardName !== detail?.name
  const autoRefreshEnabled = !!panel && !!detail && refreshSeconds > 0 && !refreshPaused
  useEffect(() => {
    if (!autoRefreshEnabled) return
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(id, appliedFilters.current, true)
    }, refreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [autoRefreshEnabled, refreshSeconds, id, load])
  const url = detail?.share_token ? `${window.location.origin}/?share=${detail.share_token}` : ''
  const addChartControls = <section className="surface">
    <SectionTitle label={panel ? 'Thêm biểu đồ vào dashboard' : 'Biểu đồ & lọc'} />
    <div className="inline-form">
      <label>Thêm biểu đồ<select value={chartId} disabled={!canEdit || locked} onChange={e => setChartId(e.target.value)}><option value="">Chọn biểu đồ</option>{charts.filter(c => !detail?.charts.some(d => d.id === c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button className="secondary-button" disabled={!canEdit || locked || !detail || !chartId || detail.charts.length >= 24} onClick={add}>Thêm</button>
      {panel && <button className="secondary-button" disabled={!canEdit || locked || !detail || detail.charts.length >= 24} onClick={() => setCreatingChart(value => !value)}>{creatingChart ? 'Đóng tạo biểu đồ' : 'Tạo biểu đồ mới trong Chat'}</button>}
    </div>
    {creatingChart && detail && <ChartsPage datasets={detail.scopeFilters?.length ? datasets.filter(d => detail.scopeFilters?.some(f => f.datasetId === d.id)) : datasets} charts={[]} dashboardId={id} previewFilters={appliedFilters.current} canEdit={canEdit} done={done} onBusyChange={setEditBusy} onCreated={async chart => { await persist(appendItem(readLayout(detail.charts), chart)); setCreatingChart(false) }} />}
  </section>
  return <>
    {panel && <div className="chat-dashboard-panel-header">
      <div><span className="eyebrow">DASHBOARD TRONG HỘI THOẠI</span><h2 id="chat-dashboard-panel-title">{detail?.name || 'Dashboard'}</h2></div>
      <button ref={closeButton} className="secondary-button" disabled={busy || editBusy || exporting} onClick={panel.onClose}>Đóng dashboard</button>
    </div>}
    <div className={panel ? 'stack chat-dashboard-panel-content' : 'stack'} inert={exporting}>
    {!panel && <>
    <DashboardTemplateForm datasets={datasets} canEdit={canEdit && !locked} created={value => { setEditingLayout(false); setId(value); done('Đã tạo dashboard từ mẫu.') }} />
    <div className="two-column dashboard-toolbar">
      <section className="surface"><SectionTitle label="Dashboard" count={availableDashboards.length} /><div className="inline-form">
        <label>Chọn dashboard<select value={id} disabled={busy} onChange={e => choose(e.target.value)}><option value="">Chọn dashboard</option>{id && !availableDashboards.some(d => d.id === id) && <option value={id}>{detail?.name || 'Dashboard mới'}</option>}{availableDashboards.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
        <label>Tạo mới<input value={name} maxLength={200} disabled={!canEdit || locked} onChange={e => setName(e.target.value)} placeholder="Tên dashboard" /></label><button className="primary-button" disabled={!canEdit || locked || !name.trim()} onClick={create}>Tạo</button>
      </div></section>
      {addChartControls}
    </div></>}
    {panel && canEdit && detail && addChartControls}
    {id && <DashboardFilters key={id + [...new Set(detail?.charts.map(c => c.datasetId) || [])].sort().join()} initialFilters={appliedFilters.current} id={id} disabled={locked || !detail} refreshedAt={refreshedAt} onApply={filters => load(id, filters)} onRefresh={() => load()} />}
    {panel && detail && <section className="surface chat-auto-refresh">
      <label>Tự động cập nhật
        <select value={refreshSeconds} onChange={event => {
          setRefreshSeconds(Number(event.target.value))
          setAutoRefreshError('')
        }}>
          <option value={0}>Tắt</option>
          <option value={30}>Mỗi 30 giây</option>
          <option value={60}>Mỗi 1 phút</option>
          <option value={300}>Mỗi 5 phút</option>
        </select>
      </label>
      <p className="hint">Dùng bộ lọc đã áp dụng và tạm dừng khi đang chỉnh sửa, xem dữ liệu chi tiết, xuất file hoặc khi tab trình duyệt ở nền.</p>
      {autoRefreshError && <p role="status" className="form-error">Tự động cập nhật thất bại. Dữ liệu lần tải trước vẫn đang hiển thị. {autoRefreshError}</p>}
    </section>}
    {status && <div className="form-error" role="status">{status}</div>}
    {panel && status && !detail && !loading && <button className="secondary-button" onClick={() => load().then(() => setStatus('')).catch(e => setStatus(message(e)))}>Tải lại dashboard</button>}
    {loading && <p role="status">Đang tải dashboard…</p>}
    {detail ? <>
      {detail.scopeFilters?.length ? <section className="notice"><div><strong>Phạm vi đã lưu từ yêu cầu Chat</strong><p>Các bộ lọc bên trên áp dụng thêm trong phạm vi này; mở lại, xuất file và chia sẻ đều giữ phạm vi.</p><ExportContext filters={detail.scopeFilters} datasets={datasets} refreshedAt="" /></div></section> : null}
      <DashboardExport key={id} dashboard={detail} filters={[...(detail.scopeFilters || []), ...appliedFilters.current]} datasets={datasets} refreshedAt={refreshedAt} root={exportRoot} disabled={locked} onBusyChange={setExporting} />
      {canEdit && <section className="surface"><form className="dashboard-rename-form" onSubmit={e => { e.preventDefault(); rename() }}><label>Tên dashboard<input maxLength={200} value={dashboardName} disabled={locked} onChange={e => setDashboardName(e.target.value)} required /></label><button className="secondary-button" disabled={locked || !dashboardName.trim() || dashboardName.trim() === detail.name}>Lưu tên</button></form>
        <div className="dashboard-layout-actions actions">{editingLayout ? <><button className="primary-button" disabled={busy || !dirty} onClick={() => mutate(() => persist(draft))}>Lưu bố cục</button><button className="secondary-button" disabled={busy} onClick={() => { setDraft(readLayout(detail.charts)); setEditingLayout(false); setStatus('') }}>Hủy bố cục</button><p>{dirty ? 'Có thay đổi chưa lưu.' : 'Chưa có thay đổi.'}</p></> : <button className="secondary-button" disabled={locked || !detail.charts.length} onClick={() => { setDraft(readLayout(detail.charts)); setEditingLayout(true); setStatus('') }}>Chỉnh bố cục</button>}</div>
      </section>}
      {detail.share_token && <section className="surface share-panel"><SectionTitle label="Liên kết công khai & nhúng" /><p className="muted">Người có liên kết có thể xem dashboard. Bố cục chia sẻ dùng cấu hình đã lưu.</p><div className="share-field"><input readOnly value={url} aria-label="Liên kết dashboard" /><button className="secondary-button" onClick={() => navigator.clipboard.writeText(url).catch(e => setStatus(message(e)))}>Sao chép</button><a className="secondary-button" href={url} target="_blank" rel="noreferrer">Mở bản xem ↗</a></div><label>Mã nhúng<textarea className="code-input" readOnly rows={2} value={`<iframe src="${url}" width="100%" height="640" title="${detail.name}"></iframe>`} /></label></section>}
      <div className="stack dashboard-export-surface" ref={exportRoot}>
      <section className="dashboard-header"><div><span className="eyebrow">DASHBOARD / {String(detail.charts.length).padStart(2, '0')} BIỂU ĐỒ</span><h2>{detail.name}</h2><p>Vị trí và kích thước được lưu riêng theo từng dashboard.</p></div>
        {canEdit && <div className="actions" data-export-exclude><button className="secondary-button" disabled={locked} onClick={share}>{detail.share_token ? 'Tắt chia sẻ' : 'Bật chia sẻ'}</button><button className="danger-link" disabled={locked} onClick={remove}>Xóa dashboard</button></div>}
      </section>
      <ExportContext filters={[...(detail.scopeFilters || []), ...appliedFilters.current]} datasets={datasets} refreshedAt={refreshedAt} />
      {detail.charts.length ? <DashboardGrid charts={detail.charts} items={editingLayout ? draft : undefined} editing={editingLayout && !busy} compactBelow={panel ? 480 : undefined} onChange={setDraft} onError={setStatus}
        onDrill={!locked ? (chart, index) => setDrill({ chart, index }) : undefined}
        onEditChart={canEdit && !locked ? editChart : undefined} onRemove={canEdit && !locked ? removeChart : undefined} /> : <section className="surface"><Empty title="Dashboard chưa có biểu đồ" text="Chọn biểu đồ đã lưu để thêm vào dashboard." /></section>}
      </div>
    </> : !loading && <section className="surface"><Empty title="Chưa chọn dashboard" text="Chọn hoặc tạo dashboard để bắt đầu." /></section>}
    {drill && <DashboardDrill id={id} chart={drill.chart} initialIndex={drill.index} filters={appliedFilters.current} onClose={() => setDrill(null)} />}
    {editSpec && <ChartEditDialog spec={editSpec} datasets={datasets} dashboardId={id} busy={editBusy} onBusyChange={setEditBusy} onCancel={() => setEditSpec(null)} onSaved={async copied => {
      await load(); setEditSpec(null); done(copied ? 'Đã lưu bản biểu đồ riêng cho dashboard này; các dashboard khác giữ nguyên.' : 'Đã lưu thay đổi biểu đồ.')
    }} />}
  </div>{exporting && <div className="dashboard-export-progress" role="status">Đang tạo file xuất… Vui lòng chờ.</div>}</>
}

function ChartEditDialog({ spec, datasets, dashboardId, busy, onBusyChange, onCancel, onSaved }: {
  spec: ChartDefinition; datasets: Dataset[]; dashboardId: string; busy: boolean; onBusyChange: (busy: boolean) => void; onCancel: () => void; onSaved: (copied: boolean) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  return <dialog className="dashboard-chart-dialog" ref={dialog} aria-labelledby="chart-edit-title" onCancel={e => { e.preventDefault(); if (!busy) onCancel() }}>
    <h2 id="chart-edit-title">Chỉnh sửa biểu đồ</h2><p className="muted">Thay đổi tiêu đề, loại và các cột cấu hình. Nếu biểu đồ được dùng ở dashboard khác, hệ thống tạo bản riêng cho dashboard này khi lưu.</p>
    <ChartsPage datasets={datasets} charts={[]} canEdit done={() => {}} editSpec={spec} dashboardId={dashboardId} onSaved={onSaved} onCancel={onCancel} onBusyChange={onBusyChange} />
  </dialog>
}

export function PublicDashboard({ token }: { token: string }) {
  const [detail, setDetail] = useState<DashboardDetail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; api<DashboardDetail>(`/share/${token}`).then(value => { if (active) setDetail(value) }).catch(e => { if (active) setError(message(e)) }); return () => { active = false } }, [token])
  return <main className="public-page"><div className="public-brand"><span className="brand-mark">P</span><strong>Pythera <small>Data Studio</small></strong><span className="tag">BẢN CHIA SẺ</span></div>
    {error ? <div className="surface"><Empty title="Không mở được dashboard" text={error} /></div> : detail ? <><header className="public-heading"><span className="eyebrow">DASHBOARD / BẢN XEM</span><h1>{detail.name}</h1><p>{detail.charts.length} biểu đồ · Dùng bố cục đã lưu, tự xếp một cột trên màn hình nhỏ.</p></header><DashboardGrid charts={detail.charts} /></> : <p>Đang tải dashboard…</p>}
  </main>
}
