import { StatisticsPanel } from './statistics-panel'
import { useEffect, useId, useRef, useState } from 'react'
import type { Dataset } from './api'
import { getExplorationReport, formatStatistic as fmt } from './exploration-api'
import type { ColumnProfile, ExplorationReport } from './exploration-api'
import { Empty, SectionTitle } from './ui'
import './exploration.css'
import { DatasetHistogram } from './dataset-histogram'

const tabs = [
  ['overview', 'Tổng quan'], ['profiling', 'Profiling'], ['missing', 'Dữ liệu thiếu'],
  ['quality', 'Chất lượng'], ['statistics', 'Thống kê cột'],
] as const
type Tab = typeof tabs[number][0]
const percent = (n: number | null) => n === null ? '—' : `${fmt(n)}%`
const bytes = (n: number) => n < 1024 ? `${fmt(n)} B` : n < 1048576 ? `${fmt(n / 1024)} KB` : `${fmt(n / 1048576)} MB`

export function ExplorationPage({ datasets, canEdit, fixedDatasetId }: {
  datasets: Dataset[]; canEdit: boolean; fixedDatasetId?: string
}) {
  const [selectedDatasetId, setDatasetId] = useState('')
  const datasetId = fixedDatasetId ?? selectedDatasetId
  const tabsId = useId()
  const [tab, setTab] = useState<Tab>('overview')
  const [report, setReport] = useState<ExplorationReport | null>(null)
  const [columnName, setColumnName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (!fixedDatasetId && !datasets.some(d => d.id === selectedDatasetId)) setDatasetId(datasets[0]?.id || '')
  }, [datasets, fixedDatasetId, selectedDatasetId])
  useEffect(() => {
    let active = true
    setReport(null); setError(''); setColumnName(''); setSearch(''); setLoading(!!datasetId)
    if (datasetId) getExplorationReport(datasetId).then(value => {
      if (active) { setReport(value); setColumnName(value.columns[0]?.name || '') }
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Không tải được báo cáo') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [datasetId, attempt])
  const column = report?.columns.find(c => c.name === columnName)
  const visible = report?.columns.filter(c => `${c.name} ${c.label} ${c.type}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) || []

  return <div className="stack exploration-page">
    <section className="surface">
      <SectionTitle label={fixedDatasetId && report ? report.name : 'Khám phá dataset'} />
      <div className="inline-form">{!fixedDatasetId && <label>Dataset<select value={datasetId} onChange={e => setDatasetId(e.target.value)} disabled={!datasets.length}>
        {!datasets.length && <option value="">Chưa có dataset</option>}
        {datasets.map(d => <option key={d.id} value={d.id}>{d.name} · {d.kind === 'PHYSICAL' ? 'Vật lý' : 'SQL ảo'}</option>)}
      </select></label>}<button className="secondary-button" disabled={!datasetId || loading} onClick={() => setAttempt(a => a + 1)}>Tải lại báo cáo</button></div>
      {fixedDatasetId && <p className="hint">Báo cáo sử dụng dữ liệu hiện tại của dataset trong tin nhắn.</p>}
      <p className="hint">Báo cáo chỉ đọc, tính trên toàn bộ dataset. Không xóa hay sửa dữ liệu gốc. Có thể cần thời gian với dataset lớn.</p>
    </section>
    {!fixedDatasetId && !datasets.length ? <section className="surface"><Empty title="Chưa có dataset" text="Nhập CSV hoặc tạo dataset từ PostgreSQL trước khi khám phá." /></section>
      : loading ? <section className="surface" role="status" aria-live="polite">Đang phân tích toàn bộ dataset…</section>
      : error ? <section className="surface"><p className="form-error" role="alert">{error}</p><button className="secondary-button" onClick={() => setAttempt(a => a + 1)}>Thử lại</button></section>
      : report && <>
        <div className="exploration-report-meta"><span>Toàn bộ dataset · {report.sampled ? 'Có lấy mẫu' : 'Không lấy mẫu'}</span><span>Cập nhật: {new Date(report.generatedAt).toLocaleString('vi-VN')}</span></div>
        {report.overview.rowCount === 0 && <div className="notice" role="status">Dataset rỗng. Cấu trúc cột vẫn hiển thị; tỷ lệ và thống kê không có dữ liệu được ghi “—”.</div>}
        <div className="exploration-tabs" role="tablist" aria-label="Nội dung khám phá">
          {tabs.map(([key, label]) => <button type="button" key={key} role="tab" id={`${tabsId}-${key}`} aria-controls={tabsId} aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
        </div>
        <section className="surface" id={tabsId} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`}>
          {tab === 'overview' && <>
            <div className="metric-grid">{[
              ['Số dòng', fmt(report.overview.rowCount)], ['Số cột dữ liệu', fmt(report.overview.columnCount)],
              ['Dung lượng logic', bytes(report.overview.sizeBytes)], ['Tỷ lệ ô thiếu', percent(report.overview.missingRate)],
            ].map(([label, value]) => <div className="metric-tile" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
            <p className="muted">{report.overview.sizeDescription}. Phạm vi dataset ảo phụ thuộc câu SQL đã lưu.</p>
            <SectionTitle label="Cấu trúc dữ liệu" count={report.columns.length} />
            <div className="table-scroll"><table><thead><tr><th>Tên cột</th><th>Nhãn</th><th>Kiểu PostgreSQL</th><th>Nhóm kiểu</th></tr></thead><tbody>{report.columns.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.label}</td><td>{c.type}</td><td>{c.kind}</td></tr>)}</tbody></table></div>
          </>}
          {(tab === 'profiling' || tab === 'missing') && <>
            <SectionTitle label={tab === 'profiling' ? 'Profiling từng cột' : 'Dữ liệu thiếu từng cột'} />
            <label>Tìm cột<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên cột, nhãn hoặc kiểu dữ liệu" /></label>
            <p className="muted">Giá trị thiếu gồm NULL và chuỗi chỉ chứa dấu cách. Giá trị số NaN/Infinity được tính riêng là không hợp lệ.</p>
            <div className="table-scroll"><table><thead><tr><th>Cột</th><th>NULL</th><th>Chuỗi trống</th><th>Tổng thiếu</th><th>Tỷ lệ thiếu</th>{tab === 'profiling' && <><th>Hợp lệ</th><th>Duy nhất</th><th>Không hợp lệ hiện tại</th><th>Sai kiểu lúc nhập CSV</th></>}</tr></thead>
              <tbody>{visible.map(c => <tr key={c.name}><td><button className="text-link" onClick={() => { setColumnName(c.name); setTab('statistics') }}>{c.label}</button><small className="exploration-column-name">{c.name}</small></td><td>{fmt(c.nullCount)}</td><td>{fmt(c.blankCount)}</td><td>{fmt(c.missingCount)}</td><td><div className="missing-rate"><progress max={100} value={c.missingRate ?? 0} aria-label={`Tỷ lệ thiếu ${c.name}`} />{percent(c.missingRate)}</div></td>{tab === 'profiling' && <><td>{fmt(c.validCount)}</td><td>{fmt(c.distinctCount)}</td><td>{fmt(c.invalidCount)}</td><td>{fmt(c.importInvalidCount)}</td></>}</tr>)}</tbody></table></div>
            {!visible.length && <Empty title="Không có cột phù hợp" text="Thử thay đổi từ khóa tìm kiếm." />}
          </>}
          {tab === 'quality' && <>
            <SectionTitle label="Chất lượng dữ liệu" />
            <div className="exploration-quality-grid">{[['Ô thiếu', report.quality.missingCells], ['Số không hữu hạn', report.quality.invalidCells], ['Dòng trùng dư', report.quality.duplicateRows]].map(([label, value]) => <div className="metric-tile" key={String(label)}><span>{label}</span><strong>{fmt(value)}</strong></div>)}</div>
            <p className="muted">{report.quality.duplicateDescription}</p>
            <ul>{report.quality.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
            <p>Không tự đánh giá đạt/không đạt khi chưa có ngưỡng chất lượng nghiệp vụ.</p>
            {report.quality.importSnapshot && <div className="subsection"><SectionTitle label="Chất lượng tại thời điểm nhập CSV" /><p>Ngày nhập: {new Date(report.quality.importSnapshot.created_at).toLocaleString('vi-VN')}</p><p>Số dòng: {fmt(report.quality.importSnapshot.row_count)} · Ô thiếu ban đầu: {fmt(report.quality.importSnapshot.missing_count)} · Ô sai kiểu ban đầu: {fmt(report.quality.importSnapshot.invalid_count)}</p><p className="muted">Đây là số liệu lịch sử, tách riêng với chất lượng hiện tại sau khi ô sai kiểu đã chuyển NULL.</p></div>}
          </>}
          {tab === 'statistics' && <>
            <SectionTitle label="Thống kê và phân phối từng cột" />
            <label>Chọn cột<select value={columnName} onChange={e => setColumnName(e.target.value)}>{report.columns.map(c => <option key={c.name} value={c.name}>{c.label} ({c.name}) · {c.type}</option>)}</select></label>
            {column && <ColumnStatistics column={column} datasetId={datasetId} />}
          </>}
        </section>
        {!fixedDatasetId && <StatisticsPanel key={datasetId} datasetId={datasetId} columns={report.columns} canEdit={canEdit} />}
        <section className="surface"><SectionTitle label="Phạm vi và lưu ý" /><ul>{report.warnings.map(w => <li key={w}>{w}</li>)}</ul></section>
      </>}
  </div>
}

export function ExplorationReportDialog({ datasetId, onClose }: { datasetId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  return <dialog className="dashboard-chart-dialog exploration-report-dialog" ref={dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="exploration-report-dialog-header">
      <h2 id={titleId}>Báo cáo khám phá chi tiết</h2>
      <button className="secondary-button" onClick={onClose}>Đóng báo cáo</button>
    </header>
    <ExplorationPage datasets={[]} fixedDatasetId={datasetId} canEdit={false} />
  </dialog>
}

function ColumnStatistics({ column: c, datasetId }: { column: ColumnProfile; datasetId: string }) {
  const stats = [['Hợp lệ', c.validCount], ['Duy nhất', c.distinctCount], ['Min', c.min], ['Max', c.max],
    ['Mean', c.mean], ['Median', c.median], ['Mode', c.mode], ['Độ lệch chuẩn mẫu', c.standardDeviation],
    ['Phương sai mẫu', c.variance], ['Q1 (25%)', c.q1], ['Q2 (50%)', c.median], ['Q3 (75%)', c.q3]]
  const max = Math.max(1, ...c.topValues.map(v => v.frequency))
  return <>
    <p className="muted">{c.statisticsNote}</p>
    <div className="exploration-stat-grid">{stats.map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{fmt(value)}</strong></div>)}</div>
    <p className="hint">{c.modeNote}</p>
    {c.kind === 'number' && <DatasetHistogram key={`${datasetId}:${c.name}`} datasetId={datasetId} column={c.name} />}
    <div className="subsection"><SectionTitle label="Giá trị phổ biến" /><p className="muted">Tần suất trên toàn bộ dataset, bỏ qua giá trị thiếu/không hợp lệ.{c.topValuesTruncated && ' Chỉ hiển thị 10 giá trị phổ biến nhất.'}</p>
      {c.topValues.length ? <div className="table-scroll"><table><thead><tr><th>Giá trị</th><th>Tần suất</th><th>So sánh tần suất</th></tr></thead><tbody>{c.topValues.map((v, i) => <tr key={i}><td className="exploration-value">{v.value}</td><td>{fmt(v.frequency)}</td><td><progress max={max} value={v.frequency} aria-label={`Tần suất ${v.value}`} /></td></tr>)}</tbody></table></div> : <Empty title="Không có giá trị hợp lệ" text="Cột rỗng hoặc chỉ có dữ liệu thiếu/không hợp lệ." />}
    </div>
  </>
}
