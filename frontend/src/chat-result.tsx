import { Component, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChartCanvas } from './ui'
import { ChatDashboard } from './chat-dashboard'
import type { OpenChatDashboard } from './chat-dashboard'
import { parseChatResult, formatResultValue as fmt } from './chat-result-model'
import type { AnalysisResult, Measurement, ResultTable } from './chat-result-model'
import './chat-result.css'

const stateLabels = { success: 'Đã có kết quả', insufficient_data: 'Không đủ dữ liệu', not_applicable: 'Không áp dụng', error: 'Không thực hiện được' }
const assumptionLabels = { passed: 'Đạt', failed: 'Không đạt', not_checked: 'Chưa kiểm tra', not_applicable: 'Không áp dụng' }
function Text({ content }: { content: string }) { return <div className="message-content">{content.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div> }

export function ChatResult({ metadataJson, content, openDashboard, dashboardVersions, datasetId, onOpenReport }: {
  metadataJson: string; content: string; openDashboard: OpenChatDashboard; dashboardVersions?: Record<string, number>
  datasetId?: string; onOpenReport?: (id: string) => void
}) {
  const parsed = useMemo(() => parseChatResult(metadataJson), [metadataJson])
  const result = parsed.result
  const reportId = parsed.explorationDatasetId
  return <>
    {result ? <details className="chat-result-original"><summary>Xem câu trả lời dạng văn bản</summary><Text content={content} /></details> : <Text content={content} />}
    {parsed.problems.length > 0 && <div className="chat-result-warning" role="status">{parsed.problems.map((p, i) => <p key={i}>{p}</p>)}</div>}
    <div className="message-meta">
      {result && <AnalysisResultView result={result} />}
      {!result && parsed.table && <ResultTableView table={parsed.table} />}
      {parsed.dashboardId && <ChatDashboard id={parsed.dashboardId} openDashboard={openDashboard} revision={dashboardVersions?.[parsed.dashboardId]} />}
    </div>
    {reportId && reportId.toLowerCase() === datasetId?.toLowerCase() && onOpenReport &&
      <button className="secondary-button chat-exploration-button" onClick={() => onOpenReport(reportId)}>Xem báo cáo chi tiết</button>}
  </>
}

export function AnalysisResultView({ result: r }: { result: AnalysisResult }) {
  const assumptionsUncertain = r.assumptions.some(a => a.status === 'failed' || a.status === 'not_checked')
  return <section className="chat-analysis-result" aria-label={r.kind === 'statistical_test' ? 'Kết quả kiểm định thống kê' : 'Kết quả phân tích dữ liệu'}>
    <div className="chat-result-heading"><h3>{r.title}</h3><span className={`chat-result-badge ${r.status}`}>{stateLabels[r.status]}</span></div>
    {r.summary && <p>{r.summary}</p>}
    {r.status !== 'success' && <div className="chat-result-warning" role="status"><strong>{stateLabels[r.status]}</strong><p>{r.reason || 'Engine chưa cung cấp đủ thông tin để thực hiện phân tích này.'}</p><p>Chưa thể đưa ra kết luận kiểm định từ kết quả này.</p></div>}
    {r.kind === 'statistical_test' && <>
      <dl className="chat-result-facts"><div><dt>Phương pháp</dt><dd>{r.method || 'Chưa được engine cung cấp'}</dd></div><div><dt>Mức ý nghĩa α</dt><dd>{fmt(r.alpha)}</dd></div></dl>
      <div className="chat-result-section"><h4>Giả thuyết</h4><dl className="chat-result-facts"><div><dt>H0</dt><dd>{r.hypotheses?.h0 || 'Chưa được engine cung cấp'}</dd></div><div><dt>H1</dt><dd>{r.hypotheses?.h1 || 'Chưa được engine cung cấp'}</dd></div></dl></div>
      <div className="chat-result-section"><h4>Cỡ mẫu và dữ liệu thiếu</h4><dl className="chat-result-facts"><div><dt>Số quan sát đầu vào</dt><dd>{fmt(r.sample?.total)}</dd></div><div><dt>Số quan sát sử dụng</dt><dd>{fmt(r.sample?.used)}</dd></div><div><dt>Số quan sát thiếu hoặc không hợp lệ</dt><dd>{fmt(r.sample?.missing)}</dd></div>{r.sample?.excluded !== undefined && <div><dt>Số dòng ngoài nhóm được chọn</dt><dd>{fmt(r.sample.excluded)}</dd></div>}{r.sample?.groups.map((g, i) => <div key={i}><dt>{g.name}</dt><dd>{fmt(g.count)}</dd></div>)}</dl></div>
      <div className="chat-result-section"><h4>Kết quả kiểm định</h4><div className="chat-test-metrics">
        <Metric title={r.statistic?.name ? `Statistic (${r.statistic.name})` : 'Statistic'} measurement={r.statistic} />
        <Metric title="P-value" measurement={r.pValue} />
        <div className="chat-test-metric"><span>Confidence interval</span><strong>{r.confidenceInterval?.status === 'available' && r.confidenceInterval.lower !== null && r.confidenceInterval.upper !== null ? `[${fmt(r.confidenceInterval.lower)}; ${fmt(r.confidenceInterval.upper)}]` : '—'}</strong>
          <small>{r.confidenceInterval?.status === 'available' && r.confidenceInterval.lower !== null && r.confidenceInterval.upper !== null ? `Mức tin cậy (tỷ lệ): ${fmt(r.confidenceInterval.level)}` : fieldReason(r.confidenceInterval)}</small></div>
        <Metric title={r.effectSize?.name ? `Effect size (${r.effectSize.name})` : 'Effect size'} measurement={r.effectSize} />
      </div></div>
      <div className="chat-result-section"><h4>Giả định của phương pháp</h4>{r.assumptions.length ? <ul className="chat-assumptions">{r.assumptions.map((a, i) => <li key={i}><div><strong>{a.name}</strong><span className={`chat-result-badge ${a.status}`}>{assumptionLabels[a.status]}</span></div>{a.detail && <p>{a.detail}</p>}</li>)}</ul> : <p className="muted">Engine chưa cung cấp đánh giá giả định; không mặc định coi các giả định đã đạt.</p>}</div>
      {assumptionsUncertain && <p className="chat-result-warning">Có giả định chưa được xác nhận hoặc không đạt. Cần xem cảnh báo và phương pháp xử lý của engine trước khi sử dụng kết luận.</p>}
    </>}
    {r.warnings.length > 0 && <div className="chat-result-warning" role="status"><h4>Cảnh báo</h4><ul>{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
    {r.data && <ResultTableView key={JSON.stringify(r.data.columns)} table={r.data} />}
    {r.charts.length > 0 && <div className="chat-result-section"><h4>Biểu đồ từ kết quả</h4><p className="muted">Biểu đồ dùng số liệu trả về. Nếu bảng bị giới hạn, biểu đồ cũng chỉ phản ánh phần kết quả đó.</p><div className="chat-result-charts">{r.charts.map((chart, i) => <ChartBoundary key={i}><article><h4>{chart.name || chart.chartType}</h4><ChartCanvas data={chart} /></article></ChartBoundary>)}</div></div>}
    {r.kind === 'statistical_test' && <div className="chat-result-section"><h4>{r.status === 'success' ? 'Kết luận của engine' : 'Thông tin từ engine'}</h4><p>{r.conclusion || (r.status === 'success' ? 'Engine chưa cung cấp kết luận. Giao diện không tự kết luận từ p-value.' : r.reason || 'Chưa có kết luận.')}</p></div>}
    <div className="chat-result-provenance"><span>Nguồn: {r.provenance?.engine || 'Engine chưa được ghi nhận'}{r.provenance?.version ? ` · ${r.provenance.version}` : ''}</span>
      <span>{r.provenance?.sampled === true ? `Có lấy mẫu · cỡ mẫu: ${fmt(r.provenance.sampleSize)}` : r.provenance?.sampled === false ? 'Không lấy mẫu trong bước tính này' : 'Chưa có thông tin lấy mẫu'}</span>
      {r.provenance?.scope === 'dataset-definition' && <span>Phạm vi theo định nghĩa dataset, gồm các điều kiện SQL đã lưu.</span>}
      {r.provenance?.missingPolicy && <span>Xử lý thiếu: {r.provenance.missingPolicy}</span>}
    </div>
  </section>
}
function fieldReason(m?: { status: Measurement['status']; reason?: string }): string {
  return m?.reason || (m?.status === 'not_applicable' ? 'Không áp dụng cho phương pháp này' : m?.status === 'not_computed' ? 'Chưa được engine tính' : 'Chưa được engine cung cấp')
}
function Metric({ title, measurement: m }: { title: string; measurement?: Measurement }) {
  return <div className="chat-test-metric"><span>{title}</span><strong>{m?.status === 'available' ? fmt(m.value) : '—'}</strong>{(m?.status !== 'available' || m.value === null) && <small>{fieldReason(m)}</small>}</div>
}
export function ResultTableView({ table }: { table: ResultTable }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(table.rows.length / 25))
  const current = Math.min(page, pages - 1)
  const start = current * 25
  return <div className="chat-result-section"><h4>Bảng số liệu</h4>
    {table.truncated && <p className="chat-result-warning" role="status">Kết quả đã giới hạn. Bảng và biểu đồ không đại diện cho toàn bộ dòng/nhóm nguồn.{table.receivedRows > 500 && ` Chỉ hiển thị 500/${table.receivedRows} dòng đã nhận.`}</p>}
    {!table.rows.length ? <p className="muted">Không có dòng kết quả phù hợp.</p> : <>
      <div className="table-scroll" tabIndex={0} aria-label="Bảng kết quả phân tích"><table><thead><tr>{table.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.slice(start, start + 25).map((row, i) => <tr key={start + i}>{table.columns.map(c => <td key={c}>{!Object.hasOwn(row, c) ? '—' : row[c] === null ? 'NULL' : String(row[c])}</td>)}</tr>)}</tbody></table></div>
      <div className="chat-result-pagination"><span>Dòng {start + 1}–{Math.min(start + 25, table.rows.length)} / {table.rows.length} dòng kết quả</span><div><button type="button" className="secondary-button" disabled={current === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Trước</button><button type="button" className="secondary-button" disabled={current + 1 >= pages} onClick={() => setPage(p => p + 1)}>Sau</button></div></div>
    </>}
  </div>
}
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p className="chat-result-warning" role="status">Không hiển thị được biểu đồ này. Bảng và nội dung kết quả vẫn được giữ.</p> : this.props.children }
}
