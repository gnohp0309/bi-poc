import type { EChartsCoreOption } from 'echarts/core'
import type { ChartData } from './api'

export const numericValue = (value: unknown): number | null =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)

export function extendedOptions(data: ChartData): EChartsCoreOption | null {
  const common = { tooltip: { trigger: 'item' }, grid: { left: 70, right: 30, top: 30, bottom: 75 } }
  if (data.chartType === 'histogram') return {
    ...common, tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', name: data.metric, data: data.rows.map((r, i) => `${Number(r.lower_bound).toLocaleString('vi-VN')}–${Number(r.upper_bound).toLocaleString('vi-VN')}${i === data.rows.length - 1 ? ']' : ')'}`), axisLabel: { rotate: 25 } },
    yAxis: { type: 'value', name: 'Số dòng', minInterval: 1 },
    series: [{ type: 'bar', barCategoryGap: '2%', data: data.rows.map(r => numericValue(r.value)), itemStyle: { color: '#476b62' } }],
  }
  if (data.chartType === 'scatter') return {
    ...common, xAxis: { type: 'value', name: data.dimension, scale: true }, yAxis: { type: 'value', name: data.metric, scale: true },
    series: [{ type: 'scatter', symbolSize: 9, data: data.rows.map(r => [numericValue(r.x), numericValue(r.y)]), itemStyle: { color: '#476b62', opacity: 0.7 } }],
  }
  if (data.chartType === 'heatmap') {
    const names = data.numericColumns || [...new Set(data.rows.map(r => String(r.x)))]
    return {
      ...common, grid: { left: 90, right: 35, top: 30, bottom: 105 },
      xAxis: { type: 'category', data: names, axisLabel: { rotate: 25 } }, yAxis: { type: 'category', data: names },
      visualMap: { min: -1, max: 1, orient: 'horizontal', left: 'center', bottom: 0, calculable: true, inRange: { color: ['#446da0', '#f5f5ec', '#a5483f'] } },
      series: [{ type: 'heatmap', data: data.rows.filter(r => numericValue(r.value) !== null).map(r => [names.indexOf(String(r.x)), names.indexOf(String(r.y)), numericValue(r.value)]), label: { show: names.length <= 5, formatter: (p: unknown) => { const v = (p as { value: number[] }).value[2]; return v.toFixed(2) } } }],
    }
  }
  if (data.chartType === 'stacked-bar' || data.chartType === 'stacked-area') {
    const labels = [...new Set(data.rows.map(r => String(r.label ?? '—')))]
    const seriesNames = [...new Set(data.rows.map(r => String(r.series ?? '—')))]
    return {
      ...common, tooltip: { trigger: 'axis' }, legend: { type: 'scroll', bottom: 0 },
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 7 ? 25 : 0 } }, yAxis: { type: 'value' },
      series: seriesNames.map(name => ({ name, type: data.chartType === 'stacked-bar' ? 'bar' : 'line', stack: 'total',
        ...(data.chartType === 'stacked-area' ? { areaStyle: {}, smooth: false } : {}),
        data: labels.map(label => { const row = data.rows.find(r => String(r.label ?? '—') === label && String(r.series ?? '—') === name); return row ? numericValue(row.value) : 0 }),
      })),
    }
  }
  return null
}
