import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { api } from './api'
import type { Chart, DashboardDetail, Dataset } from './api'
import { ChartCanvas } from './ui'
import { DashboardsPage } from './dashboards'

export type OpenChatDashboard = (id: string, trigger: HTMLButtonElement) => void

function useChatDashboard(id: string, revision: number) {
  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setDashboard(null)
    setError('')
    api<DashboardDetail>('/dashboards/' + encodeURIComponent(id))
      .then(detail => { if (active) setDashboard(detail) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Không tải được biểu đồ') })
    return () => { active = false }
  }, [id, attempt, revision])

  return { dashboard, error, retry: () => setAttempt(value => value + 1) }
}

export function ChatDashboard({ id, openDashboard, revision = 0 }: { id: string; openDashboard: OpenChatDashboard; revision?: number }) {
  const { dashboard, error, retry } = useChatDashboard(id, revision)

  return <section className="chat-dashboard-preview" aria-label="Biểu đồ trong hội thoại">
    <div className="chat-dashboard-heading">
      <div>
        <span className="eyebrow">DASHBOARD TRONG HỘI THOẠI</span>
        <h3>{dashboard?.name || 'Biểu đồ từ dashboard đã tạo'}</h3>
      </div>
      <button className="text-link" onClick={event => openDashboard(id, event.currentTarget)}>Mở dashboard trong Chat</button>
    </div>
    {error ? <div className="chat-chart-status" role="status">
      <p>Chưa tải được các biểu đồ: {error}</p>
      <button className="secondary-button" onClick={retry}>Tải lại biểu đồ</button>
    </div> : !dashboard ? <p className="chat-chart-status muted" role="status">Đang tải biểu đồ…</p>
      : dashboard.charts.length ? <div className="chat-dashboard-charts">
        {dashboard.charts.map(chart => <article className="chat-dashboard-chart" key={chart.id}>
          <h4>{chart.name}</h4>
          <ChartCanvas data={chart} />
        </article>)}
      </div> : <p className="chat-chart-status muted">Dashboard hiện chưa có biểu đồ.</p>}
  </section>
}

export function ChatDashboardPanel({ id, datasets, charts, canEdit, done, onClose, leaveGuard }: {
  id: string; datasets: Dataset[]; charts: Chart[]; canEdit: boolean; done: (message: string) => void
  onClose: () => void; leaveGuard: RefObject<(() => boolean) | null>
}) {
  return <aside className="surface chat-dashboard-panel" aria-labelledby="chat-dashboard-panel-title">
    <DashboardsPage dashboards={[]} charts={charts} datasets={datasets} canEdit={canEdit} done={done}
      initialId={id} panel={{ onClose, leaveGuard }} />
  </aside>
}
