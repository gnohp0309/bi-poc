import { useEffect, useState } from 'react'
import { api } from './api'
import type { DashboardDetail } from './api'
import { ChartCanvas } from './ui'

export function ChatDashboard({ id, openDashboard }: { id: string; openDashboard: (id: string) => void }) {
  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setDashboard(null)
    setError('')
    api<DashboardDetail>('/dashboards/' + id)
      .then(detail => { if (active) setDashboard(detail) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Không tải được biểu đồ') })
    return () => { active = false }
  }, [id, attempt])

  return <section className="chat-dashboard-preview" aria-label="Biểu đồ trong hội thoại">
    <div className="chat-dashboard-heading">
      <div>
        <span className="eyebrow">DASHBOARD TRONG HỘI THOẠI</span>
        <h3>{dashboard?.name || 'Biểu đồ từ dashboard đã tạo'}</h3>
      </div>
      <button className="text-link" onClick={() => openDashboard(id)}>Mở dashboard đầy đủ ↗</button>
    </div>
    {error ? <div className="chat-chart-status" role="status">
      <p>Chưa tải được các biểu đồ: {error}</p>
      <button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Tải lại biểu đồ</button>
    </div> : !dashboard ? <p className="chat-chart-status muted" role="status">Đang tải biểu đồ…</p>
      : dashboard.charts.length ? <div className="chat-dashboard-charts">
        {dashboard.charts.map(chart => <article className="chat-dashboard-chart" key={chart.id}>
          <h4>{chart.name}</h4>
          <ChartCanvas data={chart} />
        </article>)}
      </div> : <p className="chat-chart-status muted">Dashboard hiện chưa có biểu đồ.</p>}
  </section>
}
