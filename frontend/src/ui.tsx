import { lazy, Suspense, useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ChartData, QueryResult } from './api'
import { formatNumber } from './api'
import { extendedOptions, numericValue } from './chart-options'
import { formatStatistic } from './exploration-api'
const GeographicChart = lazy(() => import('./geographic-chart'))

echarts.use([BarChart, LineChart, PieChart, ScatterChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, CanvasRenderer])

export function ChartCanvas({ data, onPoint }: { data: ChartData; onPoint?: (index: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pointHandler = useRef(onPoint); pointHandler.current = onPoint
  useEffect(() => {
    if (!ref.current || !data.rows.length || data.chartType === 'kpi' || data.chartType === 'map') return
    const chart = echarts.init(ref.current)
    const colors = ['#476B62', '#A7BDB0', '#DAC9A6', '#8D9FB5', '#C2A69B']
    const points = data.rows.map(row => ({ name: String(row.label ?? '—'), value: numericValue(row.value) }))
    chart.setOption(extendedOptions(data) || (data.chartType === 'pie' || data.chartType === 'donut' ? {
      color: colors,
      tooltip: { trigger: 'item', valueFormatter: formatNumber },
      legend: { bottom: 0, textStyle: { color: '#6F7471' } },
      series: [{ type: 'pie', radius: data.chartType === 'donut' ? ['42%', '72%'] : '72%', center: ['50%', '44%'], data: points,
        itemStyle: { borderColor: '#fff', borderWidth: 3 }, label: { color: '#4A514D' } }]
    } : {
      color: [colors[0]],
      tooltip: { trigger: 'axis', valueFormatter: formatNumber },
      grid: { left: 78, right: 18, top: 20, bottom: 55 },
      xAxis: { type: 'category', data: points.map(p => p.name), axisLabel: { color: '#777C79', rotate: points.length > 8 ? 35 : 0 }, axisLine: { lineStyle: { color: '#D9DEDA' } }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: '#777C79', formatter: (v: number) => Math.abs(v) >= 1_000_000 ? `${formatNumber(v / 1_000_000)} tr` : formatNumber(v) }, splitLine: { lineStyle: { color: '#EDF0EC' } } },
      series: [{ type: data.chartType, data: points.map(p => p.value), smooth: true,
        itemStyle: { color: colors[0], borderRadius: data.chartType === 'bar' ? [4, 4, 0, 0] : 0 },
        areaStyle: data.chartType === 'line' ? { color: 'rgba(71,107,98,.07)' } : undefined }]
    }))
    chart.on('click', (event: unknown) => {
      const point = event as { dataIndex: number; seriesName?: string; name?: string }
      let index = point.dataIndex
      if (data.chartType === 'heatmap') index = data.rows.map((r, i) => ({ r, i })).filter(({ r }) => numericValue(r.value) !== null)[point.dataIndex]?.i ?? -1
      if (data.chartType.startsWith('stacked-')) index = data.rows.findIndex(r => String(r.label ?? '—') === point.name && String(r.series ?? '—') === point.seriesName)
      if (index >= 0) pointHandler.current?.(index)
    })
    const observer = new ResizeObserver(() => { const node = ref.current; if (!chart.isDisposed() && node?.isConnected && node.clientWidth > 0 && node.clientHeight > 0) chart.resize() })
    observer.observe(ref.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [data])
  if (!data.rows.length) return <Empty title="Không có dữ liệu" text="Không có dữ liệu phù hợp để hiển thị biểu đồ." />
  const notes = <>{data.truncated && <p className="form-error" role="status">Kết quả đã bị giới hạn; xem lưu ý trước khi diễn giải biểu đồ.</p>}{data.notes?.map(note => <p className="hint" key={note}>{note}</p>)}</>
  if (data.chartType === 'kpi') return <><div className="chart-kpi" role="img" aria-label={`KPI ${data.name || data.metric}`}><span>{data.name || data.metric}</span><strong>{formatStatistic(data.rows[0]?.value)}</strong><small>{data.aggregate.toUpperCase()} · {data.metric === '*' ? 'Số dòng' : data.metric}</small></div>{notes}</>
  if (data.chartType === 'map') return <><Suspense fallback={<p role="status">Đang tải bản đồ…</p>}><GeographicChart data={data} onPoint={onPoint} /></Suspense>{notes}</>
  return <><div className="chart-canvas" ref={ref} role="img" aria-label={`Biểu đồ ${data.name || data.chartType}`} />{data.chartType === 'heatmap' && data.rows.some(r => r.value === null) && <p className="hint">Ô trống: không tính được tương quan (cột hằng hoặc không đủ cặp số). Không coi là tương quan 0.</p>}{notes}</>
}

export function DataTable({ result, max = 20 }: { result: QueryResult | null; max?: number }) {
  if (!result) return <div className="empty">Chưa có dữ liệu xem trước.</div>
  return <div className="table-scroll"><table><thead><tr>{result.columns.map((column, i) => <th key={`${column}-${i}`}>{column}</th>)}</tr></thead>
    <tbody>{result.rows.slice(0, max).map((row, i) => <tr key={i}>{result.columns.map((column, j) => <td key={`${column}-${j}`}>{String(row[column] ?? '—')}</td>)}</tr>)}</tbody></table>
    <p className="table-caption">{result.rows.length} dòng hiển thị{result.truncated ? ' · Kết quả được giới hạn ở 500 dòng' : ''}</p></div>
}

export function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span className="empty-mark">∅</span><h3>{title}</h3><p>{text}</p></div>
}

export function SectionTitle({ label, count }: { label: string; count?: number }) {
  return <div className="section-title"><h2>{label}</h2>{count !== undefined && <span className="count">{count}</span>}</div>
}
