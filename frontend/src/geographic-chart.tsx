import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { ScatterChart } from 'echarts/charts'
import { GeoComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ChartData } from './api'

echarts.use([ScatterChart, GeoComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

export default function GeographicChart({ data, onPoint }: { data: ChartData; onPoint?: (index: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pointHandler = useRef(onPoint); pointHandler.current = onPoint
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let chart: ReturnType<typeof echarts.init> | undefined
    let observer: ResizeObserver | undefined
    setError('')
    import('./assets/world.geo.json?raw').then(asset => {
      if (!active || !ref.current) return
      if (!echarts.getMap('natural-earth-world')) echarts.registerMap('natural-earth-world', JSON.parse(asset.default))
      chart = echarts.init(ref.current)
      const points = data.rows.map(r => ({ name: String(r.label ?? 'Vị trí'), value: [Number(r.x), Number(r.y), r.value === null ? null : Number(r.value)] }))
      chart.setOption({
        tooltip: { trigger: 'item' },
        geo: { map: 'natural-earth-world', roam: true, zoom: 1.1, itemStyle: { areaColor: '#e5ece4', borderColor: '#aab9ad' }, emphasis: { itemStyle: { areaColor: '#c9dacb' } } },
        series: [{ type: 'scatter', coordinateSystem: 'geo', data: points, symbolSize: 12, itemStyle: { color: '#b26b35', opacity: 0.85 } }],
      })
      chart.on('click', (event: unknown) => pointHandler.current?.((event as { dataIndex: number }).dataIndex))
      observer = new ResizeObserver(() => {
        const node = ref.current
        if (active && chart && !chart.isDisposed() && node?.isConnected && node.clientWidth > 0 && node.clientHeight > 0) chart.resize()
      }); observer.observe(ref.current)
    }).catch(() => { if (active) setError('Không tải được nền bản đồ. Hãy tải lại trang.') })
    return () => { active = false; observer?.disconnect(); chart?.dispose() }
  }, [data])
  return <>{error && <p role="alert">{error}</p>}<div className="chart-canvas" ref={ref} role="img" aria-label={`Bản đồ ${data.name || ''}`} /><p className="hint">Kéo để di chuyển, cuộn để phóng to. Nền bản đồ Natural Earth, không cần API key.</p></>
}
