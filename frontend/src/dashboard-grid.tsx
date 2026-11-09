import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ChartData } from './api'
import { ChartCanvas } from './ui'
import { GRID_GAP, GRID_ROW_HEIGHT, ordered, placeItem, readLayout } from './dashboard-layout'
import type { GridItem } from './dashboard-layout'
import './dashboard-editor.css'

export function DashboardGrid({ charts, items, editing = false, compactBelow, onChange, onError, onEditChart, onRemove, onDrill }: {
  onDrill?: (chart: ChartData, index?: number) => void; charts: ChartData[]; items?: GridItem[]; editing?: boolean; onChange?: (items: GridItem[]) => void
  onError?: (message: string) => void; onEditChart?: (id: string) => void; onRemove?: (id: string) => void
  compactBelow?: number
}) {
  const grid = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; item: GridItem; items: GridItem[]; columnStep: number } | null>(null)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width:700px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width:700px)')
    const node = grid.current
    const update = () => setCompact(media.matches || (compactBelow !== undefined && !!node && node.clientWidth < compactBelow))
    const observer = compactBelow !== undefined && node ? new ResizeObserver(update) : null
    if (node) observer?.observe(node)
    update()
    media.addEventListener('change', update)
    return () => {
      observer?.disconnect()
      media.removeEventListener('change', update)
    }
  }, [compactBelow])
  const layout = items || readLayout(charts)
  function start(event: PointerEvent<HTMLButtonElement>, item: GridItem, mode: 'move' | 'resize') {
    if (!editing || compact || !grid.current || event.button !== 0) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { mode, startX: event.clientX, startY: event.clientY, item, items: layout.map(i => ({ ...i })), columnStep: (grid.current.getBoundingClientRect().width + GRID_GAP) / 12 }
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const g = gesture.current
    if (!g) return
    const dx = Math.round((event.clientX - g.startX) / g.columnStep)
    const dy = Math.round((event.clientY - g.startY) / (GRID_ROW_HEIGHT + GRID_GAP))
    try { onChange?.(placeItem(g.items, { ...g.item, ...(g.mode === 'move' ? { x: g.item.x + dx, y: g.item.y + dy } : { w: g.item.w + dx, h: g.item.h + dy }) })) }
    catch (e) { onError?.((e as Error).message) }
  }
  function stop() { gesture.current = null }
  function cancel() { const g = gesture.current; if (g) onChange?.(g.items); stop() }
  return <>
    {editing && <p className="hint">{compact ? 'Màn hình nhỏ hiển thị một cột. Dùng phần Vị trí & kích thước để sửa lưới desktop.' : 'Kéo nút Di chuyển hoặc góc Đổi kích thước. Các ô bị va chạm sẽ được đẩy xuống.'} Bấm Lưu bố cục để ghi thay đổi.</p>}
    <div className={`dashboard-grid-layout${editing ? ' is-editing' : ''}${compactBelow !== undefined && compact ? ' is-compact' : ''}`} ref={grid}>
      {ordered(layout).map(item => {
        const chart = charts.find(c => c.id === item.chartId)
        if (!chart) return null
        return <article key={item.chartId} className="surface dashboard-chart dashboard-grid-tile" data-chart-id={item.chartId}
          style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` }}>
          <div className="chart-head"><div><span className="eyebrow">{chart.chartType.toUpperCase()} / {chart.aggregate.toUpperCase()}</span><h3>{chart.name}</h3></div>
            <div className="dashboard-tile-actions" data-export-exclude>{onEditChart && <button className="text-link" disabled={editing} onClick={() => onEditChart(item.chartId)}>Sửa biểu đồ</button>}{onRemove && <button className="danger-link" disabled={editing} onClick={() => onRemove(item.chartId)}>Bỏ</button>}</div>
          </div>
          {editing && <><button className="dashboard-move-handle" disabled={compact} aria-label={`Di chuyển ${chart.name}`} onPointerDown={e => start(e, item, 'move')} onPointerMove={move} onPointerUp={stop} onPointerCancel={cancel} onLostPointerCapture={stop}>↕ Di chuyển</button>
            <PositionForm item={item} onApply={candidate => { try { onChange?.(placeItem(layout, candidate)) } catch (e) { onError?.((e as Error).message) } }} /></>}
          <div className="dashboard-grid-plot"><ChartCanvas data={chart} onPoint={onDrill && !editing ? index => onDrill(chart, index) : undefined} /></div>
          {onDrill && !editing && chart.rows.length > 0 && <button className="text-link" data-export-exclude onClick={() => onDrill(chart)}>Xem dữ liệu chi tiết</button>}
          {editing && <button className="dashboard-resize-handle" disabled={compact} aria-label={`Đổi kích thước ${chart.name}`} onPointerDown={e => start(e, item, 'resize')} onPointerMove={move} onPointerUp={stop} onPointerCancel={cancel} onLostPointerCapture={stop}>↘</button>}
        </article>
      })}
    </div>
  </>
}

function PositionForm({ item, onApply }: { item: GridItem; onApply: (item: GridItem) => void }) {
  const [values, setValues] = useState({ x: String(item.x), y: String(item.y), w: String(item.w), h: String(item.h) })
  useEffect(() => setValues({ x: String(item.x), y: String(item.y), w: String(item.w), h: String(item.h) }), [item.x, item.y, item.w, item.h])
  return <details className="dashboard-position-form"><summary>Vị trí & kích thước · X {item.x}, Y {item.y}, rộng {item.w}, cao {item.h}</summary>
    <form onSubmit={e => { e.preventDefault(); onApply({ chartId: item.chartId, x: Number(values.x), y: Number(values.y), w: Number(values.w), h: Number(values.h) }) }}>
      {(['x', 'y', 'w', 'h'] as const).map(key => <label key={key}>{({ x: 'X', y: 'Y', w: 'Rộng', h: 'Cao' })[key]}<input aria-label={`Ô ${key}`} type="number" step={1} min={key === 'w' ? 3 : key === 'h' ? 6 : 0} max={key === 'x' ? 11 : key === 'y' ? 994 : key === 'w' ? 12 : 24} value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })} required /></label>)}
      <button className="secondary-button">Áp dụng ô</button>
    </form>
  </details>
}
