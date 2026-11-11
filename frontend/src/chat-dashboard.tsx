import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { api } from './api'
import type { Chart, DashboardDetail, Dataset } from './api'
import { ChartCanvas } from './ui'
import { DashboardsPage } from './dashboards'
import { DashboardGrid } from './dashboard-grid'
import { downloadDashboardFile, ExportContext } from './dashboard-export'
import type { DashboardExportFormat } from './dashboard-export'
import { filterLabels } from './dashboard-export-model'

export type OpenChatDashboard = (id: string, trigger: HTMLButtonElement) => void

function useChatDashboard(id: string, revision: number) {
  const [dashboard, setDashboard] = useState<(DashboardDetail & { refreshedAt: string }) | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setDashboard(null)
    setError('')
    api<DashboardDetail & { refreshedAt: string }>('/dashboards/' + encodeURIComponent(id) + '/query', 'POST', { filters: [] })
      .then(detail => { if (active) setDashboard(detail) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Không tải được biểu đồ') })
    return () => { active = false }
  }, [id, attempt, revision])

  return { dashboard, error, retry: () => setAttempt(value => value + 1) }
}

export function ChatDashboard({ id, openDashboard, revision = 0, datasets, exportFormat }: {
  id: string; openDashboard: OpenChatDashboard; revision?: number; datasets: Dataset[]; exportFormat?: DashboardExportFormat
}) {
  const { dashboard, error, retry } = useChatDashboard(id, revision)
  const capture = useRef<HTMLDivElement>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const formatLabel = exportFormat === 'xlsx' ? 'Excel' : exportFormat?.toUpperCase()
  async function download() {
    if (!exportFormat || !dashboard || !capture.current || exportBusy) return
    setExportError('')
    setExportBusy(true)
    try {
      await downloadDashboardFile(exportFormat, {
        dashboard, filterLabels: filterLabels(dashboard.scopeFilters || [], datasets),
        refreshedAt: dashboard.refreshedAt, exportedAt: new Date().toISOString()
      }, capture.current)
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'Không xuất được dashboard')
    } finally { setExportBusy(false) }
  }

  return <section className="chat-dashboard-preview" aria-label="Biểu đồ trong hội thoại">
    <div className="chat-dashboard-heading">
      <div>
        <span className="eyebrow">DASHBOARD TRONG HỘI THOẠI</span>
        <h3>{dashboard?.name || 'Biểu đồ từ dashboard đã tạo'}</h3>
      </div>
      <button className="text-link" onClick={event => openDashboard(id, event.currentTarget)}>Mở dashboard trong Chat</button>
    </div>
    {exportFormat && <div className="actions">
      <button className="secondary-button" disabled={!dashboard || exportBusy} onClick={download}>{exportBusy ? 'Đang tạo file…' : `Tải ${formatLabel}`}</button>
      {exportError && <p role="alert">{exportError}</p>}
    </div>}
    {error ? <div className="chat-chart-status" role="status">
      <p>Chưa tải được các biểu đồ: {error}</p>
      <button className="secondary-button" onClick={retry}>Tải lại biểu đồ</button>
    </div> : !dashboard ? <p className="chat-chart-status muted" role="status">Đang tải biểu đồ…</p>
      : <div ref={capture} className={exportFormat ? 'dashboard-export-surface' : undefined}>
        {(exportFormat || dashboard.scopeFilters?.length) ? <ExportContext filters={dashboard.scopeFilters || []} datasets={datasets} refreshedAt={dashboard.refreshedAt} /> : null}
        {exportFormat && <h4>{dashboard.name}</h4>}
        {exportFormat && dashboard.charts.length > 0 ? <DashboardGrid charts={dashboard.charts} /> : dashboard.charts.length ? <div className="chat-dashboard-charts">
        {dashboard.charts.map(chart => <article className="chat-dashboard-chart" key={chart.id}>
          <h4>{chart.name}</h4>
          <ChartCanvas data={chart} />
        </article>)}
      </div> : <p className="chat-chart-status muted">Dashboard hiện chưa có biểu đồ.</p>}
      </div>}
  </section>
}

export function ChatDashboardPanel({ id, datasets, charts, done, onClose, onDeleted, leaveGuard }: {
  id: string; datasets: Dataset[]; charts: Chart[]; done: (message: string) => void
  onClose: () => void; onDeleted: () => void; leaveGuard: RefObject<(() => boolean) | null>
}) {
  const [expanded, setExpanded] = useState(false)
  return <aside className={'surface chat-dashboard-panel' + (expanded ? ' is-expanded' : '')} aria-labelledby="chat-dashboard-panel-title">
    <button className="text-link" onClick={() => setExpanded(value => !value)}>{expanded ? 'Thu gọn trong Chat' : 'Mở rộng vùng dashboard'}</button>
    <DashboardsPage dashboards={[]} charts={charts} datasets={datasets} canEdit={false} done={done}
      initialId={id} panel={{ onClose, onDeleted, leaveGuard }} />
  </aside>
}
