import { getInstanceByDom } from 'echarts/core'
import { pageSlices } from './dashboard-export-model'
import type { ExportSnapshot } from './dashboard-export-model'
function waitFrame() { return new Promise<void>(resolve => requestAnimationFrame(() => resolve())) }
export async function captureDashboard(root: HTMLElement) {
  await document.fonts.ready
  const deadline = performance.now() + 8000
  while (true) {
    const plots = Array.from(root.querySelectorAll<HTMLElement>('.chart-canvas'))
    if (root.querySelector('[role="alert"]')) throw new Error('Dashboard đang có lỗi hiển thị. Hãy kiểm tra trước khi xuất.')
    const ready = !Array.from(root.querySelectorAll('[role="status"]')).some(n => n.textContent?.startsWith('Đang tải')) && plots.every(plot => {
      const chart = getInstanceByDom(plot)
      return !!chart && chart.getZr().animation.isFinished()
    })
    if (ready) break
    if (performance.now() > deadline) throw new Error('Biểu đồ chưa hiển thị xong. Hãy chờ và thử xuất lại.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  root.querySelectorAll<HTMLElement>('.chart-canvas').forEach(plot => getInstanceByDom(plot)?.dispatchAction({ type: 'hideTip' }))
  await waitFrame(); await waitFrame()
  const width = root.scrollWidth, height = root.scrollHeight
  const ratio = Math.min(2, 16384 / Math.max(width, height), Math.sqrt(24000000 / (width * height)))
  if (!width || !height || ratio < 0.5) throw new Error('Dashboard quá lớn để xuất ảnh rõ nét. Hãy thu gọn khoảng trống hoặc kích thước bố cục.')
  const origin = root.getBoundingClientRect().top
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('[data-chart-id]')).map(n => { const r = n.getBoundingClientRect(); return { top: r.top - origin, bottom: r.bottom - origin } })
  const { toCanvas } = await import('html-to-image')
  const canvas = await toCanvas(root, {
    backgroundColor: '#f5f6f2', pixelRatio: ratio, width, height, skipFonts: true,
    filter: node => !(node instanceof HTMLElement && (node.hasAttribute('data-export-exclude') || node.getAttribute('data-zr-dom-id') === 'tooltip')),
    style: { margin: '0', transform: 'none' },
  })
  return { canvas, boxes: boxes.map(b => ({ top: Math.round(b.top * canvas.height / height), bottom: Math.round(b.bottom * canvas.height / height) })) }
}
export function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Không tạo được file PNG.')), 'image/png'))
}
export async function pdfBlob(capture: Awaited<ReturnType<typeof captureDashboard>>, snapshot: ExportSnapshot): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  pdf.setProperties({ title: snapshot.dashboard.name, creator: 'Pythera Data Studio' })
  const width = pdf.internal.pageSize.getWidth() - 20, height = pdf.internal.pageSize.getHeight() - 26
  const { canvas, boxes } = capture
  const slices = pageSlices(canvas.height, Math.floor(height / width * canvas.width), boxes)
  for (const [i, slice] of slices.entries()) {
    if (i) pdf.addPage()
    const part = document.createElement('canvas'); part.width = canvas.width; part.height = Math.ceil(slice.height)
    const ctx = part.getContext('2d'); if (!ctx) throw new Error('Trình duyệt không hỗ trợ xuất PDF.')
    ctx.fillStyle = '#f5f6f2'; ctx.fillRect(0, 0, part.width, part.height)
    ctx.drawImage(canvas, 0, slice.top, canvas.width, slice.height, 0, 0, part.width, slice.height)
    const scale = Math.min(width / canvas.width, height / slice.height)
    pdf.addImage(part, 'PNG', 10 + (width - canvas.width * scale) / 2, 10, canvas.width * scale, slice.height * scale, undefined, 'FAST')
    pdf.setFontSize(8); pdf.setTextColor(90); pdf.text(`${i + 1} / ${slices.length}   |   ${snapshot.exportedAt}`, 10, pdf.internal.pageSize.getHeight() - 7)
    part.width = part.height = 0
  }
  return pdf.output('blob')
}
