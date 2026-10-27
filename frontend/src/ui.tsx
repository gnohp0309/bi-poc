import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ChartData, QueryResult } from './api'
import { formatNumber } from './api'

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

export function ChartCanvas({ data }: { data: ChartData }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    const colors = ['#476B62', '#A7BDB0', '#DAC9A6', '#8D9FB5', '#C2A69B']
    const points = data.rows.map(row => ({ name: String(row.label ?? '—'), value: Number(row.value ?? 0) }))
    chart.setOption(data.chartType === 'pie' ? {
      color: colors,
      tooltip: { trigger: 'item', valueFormatter: formatNumber },
      legend: { bottom: 0, textStyle: { color: '#6F7471' } },
      series: [{ type: 'pie', radius: ['42%', '72%'], center: ['50%', '44%'], data: points,
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
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(ref.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [data])
  return <div className="chart-canvas" ref={ref} role="img" aria-label={`Biểu đồ ${data.name || data.chartType}`} />
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
