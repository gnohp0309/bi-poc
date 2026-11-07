import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { DashboardDetail, Dataset } from './api'
import type { DashboardFilter } from './dashboard-interaction'
import { fileBase, filterLabels } from './dashboard-export-model'
import type { ExportSnapshot } from './dashboard-export-model'
export function ExportContext({ filters, datasets, refreshedAt }: { filters: DashboardFilter[]; datasets: Dataset[]; refreshedAt: string }) {
  const labels = filterLabels(filters, datasets)
  return <div className="dashboard-export-context"><strong>Bộ lọc đã áp dụng</strong>{labels.length ? <ul>{labels.map((label, i) => <li key={i}>{label}</li>)}</ul> : <p>Không có bộ lọc.</p>}<p>Dữ liệu cập nhật: {refreshedAt ? new Date(refreshedAt).toLocaleString('vi-VN') : '—'}</p></div>
}
export function DashboardExport({ dashboard, filters, datasets, refreshedAt, root, disabled, onBusyChange }: {
  dashboard: DashboardDetail; filters: DashboardFilter[]; datasets: Dataset[]; refreshedAt: string; root: RefObject<HTMLDivElement | null>; disabled: boolean; onBusyChange: (busy: boolean) => void
}) {
  const [format, setFormat] = useState('')
  const [status, setStatus] = useState('')
  const running = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  async function run(type: 'png' | 'pdf' | 'xlsx') {
    if (disabled || running.current || !root.current) return
    const target = root.current
    const snapshot: ExportSnapshot = structuredClone({ dashboard, filterLabels: filterLabels(filters, datasets), refreshedAt, exportedAt: new Date().toISOString() })
    running.current = true; setFormat(type); setStatus(''); onBusyChange(true)
    let canvas: HTMLCanvasElement | undefined
    try {
      let blob: Blob
      if (type === 'xlsx') { const { workbookBlob } = await import('./dashboard-export-excel'); blob = await workbookBlob(snapshot) }
      else {
        const image = await import('./dashboard-export-image')
        const capture = await image.captureDashboard(target); canvas = capture.canvas
        blob = type === 'png' ? await image.pngBlob(canvas) : await image.pdfBlob(capture, snapshot)
      }
      if (!active.current || !target.isConnected) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `${fileBase(snapshot.dashboard.name, snapshot.exportedAt)}.${type}`
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000)
      setStatus(`Đã tạo file ${type.toUpperCase()}. Kiểm tra thư mục tải xuống của trình duyệt.`)
    } catch (e) { if (active.current) setStatus(`Không xuất được file: ${(e as Error).message}`) }
    finally { if (canvas) canvas.width = canvas.height = 0; running.current = false; if (active.current) { setFormat(''); onBusyChange(false) } }
  }
  return <section className="surface dashboard-export-toolbar"><h2>Xuất dashboard</h2><p className="hint">Xuất dữ liệu đang hiển thị với bộ lọc đã áp dụng. PNG/PDF giữ bố cục hiện tại; Excel gồm toàn bộ bảng số liệu đã tải của mỗi biểu đồ. Ẩn legend hoặc zoom không lọc các dòng trong Excel. Lưu hoặc hủy bố cục đang sửa trước khi xuất.</p>
    <div className="actions">{(['png', 'pdf', 'xlsx'] as const).map(type => <button key={type} className="secondary-button" disabled={disabled || !!format} onClick={() => run(type)}>{format === type ? 'Đang xuất…' : type === 'xlsx' ? 'Xuất Excel' : `Xuất ${type.toUpperCase()}`}</button>)}</div>
    {status && <p role="status" className={status.startsWith('Không') ? 'form-error' : 'hint'}>{status}</p>}
  </section>
}
