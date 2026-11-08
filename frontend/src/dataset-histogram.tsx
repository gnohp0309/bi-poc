import { useEffect, useState } from 'react'
import { api } from './api'
import type { ChartData } from './api'
import { ChartCanvas } from './ui'

export function DatasetHistogram({ datasetId, column }: { datasetId: string; column: string }) {
  const [requested, setRequested] = useState(false)
  const [data, setData] = useState<ChartData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!requested) return
    let active = true
    setBusy(true); setError('')
    api<ChartData>('/charts/preview', 'POST', { datasetId, chartType: 'histogram', metric: column, aggregate: 'count', binCount: 10 })
      .then(value => { if (active) setData(value) }).catch(e => { if (active) setError(e.message) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [requested, datasetId, column])
  return <div className="subsection"><h3>Phân phối theo khoảng</h3>
    {!requested && <button className="secondary-button" onClick={() => setRequested(true)}>Xem histogram</button>}
    {busy && <p role="status">Đang tổng hợp histogram trên toàn bộ dataset…</p>}
    {error && <p className="form-error" role="alert">{error}<button className="text-link" onClick={() => setRequested(false)}>Đóng để thử lại</button></p>}
    {data && <ChartCanvas data={data} />}
  </div>
}
