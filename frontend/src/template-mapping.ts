export type TemplateField = { key: string; label: string; kind: string }
export type TemplateColumn = { name: string; type: string; kind: string }
const aliases: Record<string, string[]> = {
  date: ['date', 'order_date', 'event_date', 'placed_on', 'event_time', 'ngay', 'ngay_dat_hang'],
  revenue: ['revenue', 'amount', 'total_value', 'sales_amount', 'doanh_thu'],
  region: ['region', 'area', 'khu_vuc', 'vung'],
  category: ['category', 'department', 'danh_muc', 'nhom_hang'],
  product: ['product', 'product_name', 'san_pham', 'ten_san_pham'],
  quantity: ['quantity', 'units', 'so_luong'],
  status: ['status', 'order_status', 'order_state', 'trang_thai'],
}
function normalized(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/^c_/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}
/** Only a unique semantic name match of the correct kind is suggested. Never guess from type alone. */
export function suggestMapping(fields: TemplateField[], columns: TemplateColumn[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of fields) {
    const matches = columns.filter(c => c.kind === field.kind && (aliases[field.key] || [field.key]).includes(normalized(c.name)))
    if (matches.length === 1) mapping[field.key] = matches[0].name
  }
  return mapping
}
export function fieldProblem(field: TemplateField, columns: TemplateColumn[], mapping: Record<string, string>): string {
  const compatible = columns.filter(c => c.kind === field.kind)
  if (!compatible.length) return `Thiếu cột ${field.kind === 'date' ? 'ngày/thời gian' : field.kind === 'number' ? 'số' : 'văn bản'} cho ${field.label}. Kiểm tra kiểu dữ liệu hoặc chuẩn bị dataset phù hợp.`
  if (!mapping[field.key]) return `Chọn cột cho ${field.label}; hệ thống không đoán khi tên cột không rõ hoặc có nhiều lựa chọn.`
  if (!compatible.some(c => c.name === mapping[field.key])) return `Cột đã chọn cho ${field.label} không còn phù hợp.`
  return ''
}
