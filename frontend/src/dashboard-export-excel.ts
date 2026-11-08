import ExcelJS from 'exceljs'
import type { ExportSnapshot } from './dashboard-export-model.ts'
import { cellValue, dataColumns, sheetName } from './dashboard-export-model.ts'
import { ordered, readLayout } from './dashboard-layout.ts'
const limitNote = 'Dữ liệu đã tải sau bộ lọc; giới hạn nhóm/điểm của biểu đồ được giữ nguyên. Không phải toàn bộ dữ liệu gốc. Ẩn legend hoặc zoom không lọc các dòng trong Excel.'
export function buildWorkbook(snapshot: ExportSnapshot) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Pythera Data Studio'; workbook.created = new Date(snapshot.exportedAt)
  const info = workbook.addWorksheet('Thông tin', { views: [{ state: 'frozen', ySplit: 1 }] })
  info.columns = [{ width: 28 }, { width: 100 }]
  info.addRow(['Thông tin dashboard', 'Giá trị'])
  info.addRows([
    ['Tên dashboard', snapshot.dashboard.name], ['Dashboard ID', snapshot.dashboard.id],
    ['Thời điểm xuất', snapshot.exportedAt], ['Dữ liệu cập nhật lúc', snapshot.refreshedAt],
    ['Số biểu đồ', snapshot.dashboard.charts.length], ['Bộ lọc đã áp dụng', snapshot.filterLabels.length ? snapshot.filterLabels.join('\n') : 'Không có'],
    ['Phạm vi', limitNote], ['NULL', 'Ô trống trong bảng dữ liệu là NULL; giá trị 0 vẫn được giữ là số. Chuỗi số dài được giữ dạng văn bản để tránh làm tròn.'],
  ])
  const orderedCharts = ordered(readLayout(snapshot.dashboard.charts)).map(item => snapshot.dashboard.charts.find(c => c.id === item.chartId)!)
  for (const [i, chart] of orderedCharts.entries()) {
    const name = sheetName(chart.name || chart.chartType, i)
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 8 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
    info.addRow([name, chart.name || chart.chartType])
    sheet.addRows([
      ['Biểu đồ', chart.name || chart.chartType], ['Loại / phép tính', `${chart.chartType} / ${chart.aggregate}`],
      ['Dataset ID', chart.datasetId || ''], ['Cột / metric', `${chart.dimension || '—'} / ${chart.metric || '—'}`],
      ['Số dòng đã tải', chart.rows.length], ['Giới hạn và lưu ý', [limitNote, ...(chart.notes || []), ...(chart.truncated ? ['Kết quả bị giới hạn (truncated).'] : []), ...(chart.rows.length >= 100 && ['bar', 'line', 'pie', 'donut'].includes(chart.chartType) ? ['Đã chạm 100 nhóm; có thể còn nhóm khác chưa hiển thị.'] : [])].join('\n')],
      ['Bộ lọc', snapshot.filterLabels.join('\n') || 'Không có'],
    ])
    const columns = dataColumns(chart)
    sheet.addRow(columns.length ? columns : ['Không có dữ liệu'])
    for (const row of chart.rows) sheet.addRow(columns.map(c => cellValue(row[c])))
    sheet.columns.forEach((column, j) => { column.width = Math.min(60, Math.max(22, (columns[j]?.length || 14) + 3)) })
    sheet.getColumn(2).width = Math.max(sheet.getColumn(2).width || 22, 36)
    sheet.getRow(6).height = 70; sheet.getRow(7).height = Math.min(160, Math.max(30, snapshot.filterLabels.length * 16))
    sheet.getRow(8).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF476B62' } }
    if (chart.rows.length && columns.length) sheet.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8 + chart.rows.length, column: columns.length } }
    sheet.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; if (typeof cell.value === 'number') cell.numFmt = Math.abs(cell.value) > 0 && Math.abs(cell.value) < 1e-9 ? '0.##############E+00' : '#,##0.###############' }))
  }
  info.getRow(1).font = { bold: true }; info.eachRow(row => { row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true } }); row.height = 32 })
  info.getRow(7).height = Math.min(180, Math.max(32, snapshot.filterLabels.length * 18)); info.getRow(8).height = 58; info.getRow(9).height = 45
  return workbook
}
export async function workbookBlob(snapshot: ExportSnapshot): Promise<Blob> {
  const buffer = await buildWorkbook(snapshot).xlsx.writeBuffer()
  return new Blob([new Uint8Array(buffer).buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
