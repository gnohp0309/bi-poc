import { useEffect, useState } from 'react'
import { api } from './api'
import type { Chart, ChartData, Connection, Dataset, QueryResult } from './api'
import { ChartCanvas, DataTable, Empty, SectionTitle } from './ui'

type Done = (message: string) => void
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Thao tác không thành công'
const confirmRemove = (name: string) => window.confirm(`Xóa “${name}”? Các mục phụ thuộc cũng có thể bị xóa.`)

export function ConnectionsPage({ connections, done }: { connections: Connection[]; done: Done }) {
  const [form, setForm] = useState({ name: 'Dữ liệu bán hàng mẫu', host: '127.0.0.1', port: 5433, database: 'bi_poc_source', username: 'bi_reader', password: '' })
  const [tables, setTables] = useState<{ schema: string; table: string }[]>([])
  const [selected, setSelected] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const field = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: key === 'port' ? Number(value) : value })
  async function act(path: string, save: boolean) {
    setBusy(true); setStatus('')
    try { await api(path, 'POST', form); setStatus(save ? 'Đã lưu kết nối.' : 'Kết nối thành công.'); if (save) done('Đã thêm nguồn PostgreSQL.') }
    catch (e) { setStatus(errorText(e)) } finally { setBusy(false) }
  }
  async function inspect(id: string) {
    setSelected(id)
    try { setTables(await api(`/connections/${id}/tables`)) } catch (e) { setStatus(errorText(e)) }
  }
  async function remove(item: Connection) {
    if (!confirmRemove(item.name)) return
    try { await api(`/connections/${item.id}`, 'DELETE'); if (selected === item.id) { setSelected(''); setTables([]) }; done('Đã xóa kết nối.') }
    catch (e) { setStatus(errorText(e)) }
  }
  return <div className="two-column"><section className="surface form-panel"><SectionTitle label="Thêm nguồn dữ liệu" /><p className="muted">POC hiện hỗ trợ PostgreSQL. Mật khẩu kết nối được mã hóa trong kho cấu hình.</p>
    <div className="form-grid"><label className="wide">Tên kết nối<input value={form.name} onChange={e => field('name', e.target.value)} /></label><label>Máy chủ<input value={form.host} onChange={e => field('host', e.target.value)} /></label><label>Cổng<input type="number" value={form.port} onChange={e => field('port', e.target.value)} /></label><label>Tên CSDL<input value={form.database} onChange={e => field('database', e.target.value)} /></label><label>Tài khoản<input value={form.username} onChange={e => field('username', e.target.value)} /></label><label className="wide">Mật khẩu<input type="password" value={form.password} onChange={e => field('password', e.target.value)} /></label></div>
    <div className="actions"><button className="secondary-button" disabled={busy} onClick={() => act('/connections/test', false)}>Kiểm tra kết nối</button><button className="primary-button" disabled={busy} onClick={() => act('/connections', true)}>Lưu kết nối</button></div>{status && <p className="inline-status">{status}</p>}</section>
    <section className="surface"><SectionTitle label="Nguồn đã lưu" count={connections.length} />{connections.length ? connections.map(item => <div className="record" key={item.id}><div><strong>{item.name}</strong><small>{item.host}:{item.port} / {item.database_name} · {item.username}</small></div><div className="row-actions"><button className="text-link" onClick={() => inspect(item.id)}>Xem bảng</button><button className="danger-link" onClick={() => remove(item)}>Xóa</button></div></div>) : <Empty title="Chưa có nguồn" text="Lưu kết nối để tạo dataset và chạy truy vấn." />}
      {selected && <div className="subsection"><SectionTitle label="Bảng khả dụng" count={tables.length} />{tables.map(t => <div className="list-row" key={`${t.schema}.${t.table}`}><span>{t.schema}.{t.table}</span><span className="tag">TABLE</span></div>)}</div>}</section></div>
}

export function DatasetsPage({ connections, datasets, done }: { connections: Connection[]; datasets: Dataset[]; done: Done }) {
  const [connectionId, setConnectionId] = useState('')
  const [kind, setKind] = useState<'PHYSICAL' | 'VIRTUAL'>('PHYSICAL')
  const [name, setName] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [sql, setSql] = useState('')
  const [tables, setTables] = useState<{ schema: string; table: string }[]>([])
  const [preview, setPreview] = useState<QueryResult | null>(null)
  const [selected, setSelected] = useState<Dataset | null>(null)
  const [aliases, setAliases] = useState('{}')
  const [status, setStatus] = useState('')
  useEffect(() => { if (!connectionId && connections.length) setConnectionId(connections[0].id) }, [connections, connectionId])
  useEffect(() => { if (!connectionId) return; api<{ schema: string; table: string }[]>(`/connections/${connectionId}/tables`).then(items => { setTables(items); setSourceName(items.length ? `${items[0].schema}.${items[0].table}` : '') }).catch(e => setStatus(errorText(e))) }, [connectionId])
  async function save() { try { await api('/datasets', 'POST', { connectionId, kind, name, sourceName, sql }); setName(''); done('Đã tạo dataset.'); setStatus('') } catch (e) { setStatus(errorText(e)) } }
  async function show(item: Dataset) { setSelected(item); setAliases(item.aliases_json || '{}'); try { setPreview(await api(`/datasets/${item.id}/preview`)); setStatus('') } catch (e) { setStatus(errorText(e)) } }
  async function saveAliases() { if (!selected) return; try { await api(`/datasets/${selected.id}/aliases`, 'PUT', { aliases: JSON.parse(aliases) }); done('Đã lưu tên cột thân thiện.'); setStatus('') } catch (e) { setStatus(errorText(e)) } }
  async function remove(item: Dataset) { if (!confirmRemove(item.name)) return; try { await api(`/datasets/${item.id}`, 'DELETE'); if (selected?.id === item.id) { setSelected(null); setPreview(null) }; done('Đã xóa dataset.') } catch (e) { setStatus(errorText(e)) } }
  return <div className="stack"><div className="two-column"><section className="surface form-panel"><SectionTitle label="Tạo dataset" /><div className="form-grid"><label className="wide">Nguồn kết nối<select value={connectionId} onChange={e => { setConnectionId(e.target.value); setSql('') }}><option value="">Chọn kết nối</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="wide">Tên dataset<input value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Doanh thu theo đơn" /></label></div><div className="segmented"><button className={kind === 'PHYSICAL' ? 'selected' : ''} onClick={() => setKind('PHYSICAL')}>Bảng vật lý</button><button className={kind === 'VIRTUAL' ? 'selected' : ''} onClick={() => setKind('VIRTUAL')}>SQL ảo</button></div>{kind === 'PHYSICAL' ? <label>Bảng nguồn<select value={sourceName} onChange={e => setSourceName(e.target.value)}>{tables.map(t => <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>{t.schema}.{t.table}</option>)}</select></label> : <><label>Bảng tham khảo<select value={sourceName} onChange={e => setSourceName(e.target.value)}><option value="">Chọn bảng</option>{tables.map(t => <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>{t.schema}.{t.table}</option>)}</select></label><button className="secondary-button" disabled={!sourceName} onClick={() => setSql(`SELECT * FROM ${sourceName}`)}>Chèn câu SELECT mẫu</button><label>Câu truy vấn SELECT<textarea className="code-input" rows={6} value={sql} onChange={e => setSql(e.target.value)} placeholder="Chọn bảng rồi chèn câu mẫu, hoặc tự viết SELECT có WHERE / GROUP BY" /></label><p className="hint">Bạn có thể chọn cột, lọc WHERE, tính SUM/COUNT và GROUP BY. Chỉ chấp nhận một câu SELECT/WITH đọc dữ liệu.</p></>}<div className="actions"><button className="primary-button" disabled={!connectionId || !name.trim() || (kind === 'VIRTUAL' ? !sql.trim() : !sourceName)} onClick={save}>Tạo dataset</button></div>{status && <p className="inline-status">{status}</p>}</section>
    <section className="surface"><SectionTitle label="Danh sách dataset" count={datasets.length} />{datasets.length ? datasets.map(item => <div className="record" key={item.id}><div><strong>{item.name}</strong><small>{item.kind === 'PHYSICAL' ? 'Bảng vật lý' : 'SQL ảo'} · {item.connection_name}</small></div><div className="row-actions"><button className="text-link" onClick={() => show(item)}>Xem trước</button><button className="danger-link" onClick={() => remove(item)}>Xóa</button></div></div>) : <Empty title="Chưa có dataset" text="Chọn một bảng hoặc câu SQL làm lớp dữ liệu trung gian." />}</section></div>
    {selected && <section className="surface"><SectionTitle label={`Xem trước · ${selected.name}`} /><DataTable result={preview} /><div className="subsection"><label>Tên cột thân thiện (JSON: tên cột → nhãn)<textarea className="code-input" rows={3} value={aliases} onChange={e => setAliases(e.target.value)} /></label><button className="secondary-button" onClick={saveAliases}>Lưu nhãn cột</button><p className="hint">Nhãn được lưu ở dataset; bản POC chưa thay nhãn trên biểu đồ.</p></div></section>}</div>
}

type SavedQuery = { id: string; connection_id: string; name: string; sql_text: string }
export function SqlPage({ connections, done }: { connections: Connection[]; done: Done }) {
  const [connectionId, setConnectionId] = useState('')
  const [sql, setSql] = useState('SELECT date_trunc(\'month\', order_date)::date AS month, sum(amount) AS revenue\nFROM public.orders\nGROUP BY 1 ORDER BY 1')
  const [name, setName] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [saved, setSaved] = useState<SavedQuery[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!connectionId && connections.length) setConnectionId(connections.find(c => c.database_name === 'bi_poc_source')?.id || connections[0].id) }, [connectionId, connections])
  useEffect(() => { api<SavedQuery[]>('/sql/saved').then(setSaved).catch(e => setStatus(errorText(e))) }, [])
  async function run() { setBusy(true); try { setResult(await api('/sql/execute', 'POST', { connectionId, sql })); setStatus('Truy vấn thành công.') } catch (e) { setStatus(errorText(e)) } finally { setBusy(false) } }
  async function save() { try { await api('/sql/saved', 'POST', { connectionId, name, sql }); setSaved(await api('/sql/saved')); setName(''); done('Đã lưu câu truy vấn.') } catch (e) { setStatus(errorText(e)) } }
  return <div className="stack"><div className="two-column wide-left"><section className="surface"><div className="panel-head"><SectionTitle label="Trình soạn SQL" /><span className="tag">CHỈ ĐỌC</span></div><label>Kết nối<select value={connectionId} onChange={e => setConnectionId(e.target.value)}><option value="">Chọn kết nối</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Câu truy vấn<textarea className="code-input editor" spellCheck={false} value={sql} onChange={e => setSql(e.target.value)} /></label><div className="actions"><button className="primary-button" disabled={!connectionId || busy} onClick={run}>{busy ? 'Đang chạy…' : 'Chạy truy vấn'}</button></div><p className="hint">Câu mẫu public.orders dùng kết nối PostgreSQL · Bán hàng mẫu. Chỉ một lệnh SELECT/WITH; tối đa 500 dòng và 6 giây.</p>{status && <p className="inline-status">{status}</p>}</section>
    <section className="surface"><SectionTitle label="Truy vấn đã lưu" count={saved.length} /><label>Tên truy vấn<input value={name} onChange={e => setName(e.target.value)} placeholder="Báo cáo doanh thu tháng" /></label><button className="secondary-button" disabled={!name.trim() || !connectionId} onClick={save}>Lưu để dùng lại</button><div className="subsection">{saved.length ? saved.map(item => <button className="list-row clickable full-row" key={item.id} onClick={() => { setConnectionId(item.connection_id); setSql(item.sql_text) }}><span><strong>{item.name}</strong><small>{item.sql_text.slice(0, 70)}</small></span><span>↗</span></button>) : <Empty title="Chưa lưu truy vấn" text="Lưu SQL để mở lại khi trình bày." />}</div></section></div><section className="surface"><SectionTitle label="Kết quả truy vấn" count={result?.rows.length} /><DataTable result={result} /></section></div>
}

export function ChartsPage({ datasets, charts, done }: { datasets: Dataset[]; charts: Chart[]; done: Done }) {
  const [datasetId, setDatasetId] = useState('')
  const [name, setName] = useState('')
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar')
  const [dimension, setDimension] = useState('')
  const [metric, setMetric] = useState('*')
  const [aggregate, setAggregate] = useState<'count' | 'sum' | 'avg'>('count')
  const [columns, setColumns] = useState<string[]>([])
  const [preview, setPreview] = useState<ChartData | null>(null)
  const [status, setStatus] = useState('')
  useEffect(() => { if (!datasetId && datasets.length) setDatasetId(datasets[0].id) }, [datasetId, datasets])
  useEffect(() => { if (!datasetId) return; api<QueryResult>(`/datasets/${datasetId}/preview`).then(result => { setColumns(result.columns); setDimension(result.columns[0] || ''); setMetric('*'); setAggregate('count'); setPreview(null) }).catch(e => setStatus(errorText(e))) }, [datasetId])
  const spec = { datasetId, name, chartType, dimension, metric, aggregate }
  async function show() { try { setPreview(await api('/charts/preview', 'POST', spec)); setStatus('') } catch (e) { setStatus(errorText(e)) } }
  async function save() { try { await api('/charts', 'POST', spec); setName(''); done('Đã lưu biểu đồ.'); await show() } catch (e) { setStatus(errorText(e)) } }
  async function remove(item: Chart) { if (!confirmRemove(item.name)) return; try { await api(`/charts/${item.id}`, 'DELETE'); done('Đã xóa biểu đồ.') } catch (e) { setStatus(errorText(e)) } }
  return <div className="stack"><div className="two-column"><section className="surface form-panel"><SectionTitle label="Cấu hình biểu đồ" /><div className="form-grid"><label className="wide">Dataset<select value={datasetId} onChange={e => setDatasetId(e.target.value)}><option value="">Chọn dataset</option>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="wide">Tên biểu đồ<input value={name} onChange={e => setName(e.target.value)} placeholder="Doanh thu theo vùng" /></label><label>Dạng biểu đồ<select value={chartType} onChange={e => setChartType(e.target.value as typeof chartType)}><option value="bar">Cột</option><option value="line">Đường</option><option value="pie">Tròn</option></select></label><label>Chiều dữ liệu<select value={dimension} onChange={e => setDimension(e.target.value)}>{columns.map(c => <option key={c}>{c}</option>)}</select></label><label>Phép tổng hợp<select value={aggregate} onChange={e => setAggregate(e.target.value as typeof aggregate)}><option value="count">Đếm</option><option value="sum">Tổng</option><option value="avg">Trung bình</option></select></label><label>Cột chỉ số<select value={metric} onChange={e => setMetric(e.target.value)}><option value="*">* · tất cả dòng</option>{columns.map(c => <option key={c}>{c}</option>)}</select></label></div><div className="actions"><button className="secondary-button" disabled={!datasetId || !dimension} onClick={show}>Xem trước</button><button className="primary-button" disabled={!datasetId || !dimension || !name.trim()} onClick={save}>Lưu biểu đồ</button></div>{status && <p className="inline-status">{status}</p>}</section><section className="surface chart-preview"><SectionTitle label="Xem trước trực quan" />{preview ? <ChartCanvas data={{ ...preview, name: name || 'Bản xem trước' }} /> : <Empty title="Chưa có bản xem" text="Chọn chiều dữ liệu và phép tổng hợp, rồi nhấn Xem trước." />}</section></div><section className="surface"><SectionTitle label="Biểu đồ đã lưu" count={charts.length} /><div className="item-grid">{charts.map(item => <div className="item-card" key={item.id}><span className="tag">{item.chart_type.toUpperCase()}</span><h3>{item.name}</h3><p>{item.dataset_name}</p><small>{item.aggregate.toUpperCase()}({item.metric}) theo {item.dimension}</small><button className="danger-link" onClick={() => remove(item)}>Xóa biểu đồ</button></div>)}</div>{!charts.length && <Empty title="Chưa có biểu đồ" text="Biểu đồ được tạo không cần viết mã." />}</section></div>
}

type User = { id: string; username: string; role: string; active: boolean }
type Group = { id: string; name: string; members: string[] }
type Audit = { id: number; actor: string; action: string; object_type: string; object_id: string; created_at: string }
export function SecurityPage() {
  const [users, setUsers] = useState<User[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [audit, setAudit] = useState<Audit[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('VIEWER')
  const [groupName, setGroupName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [userId, setUserId] = useState('')
  const [status, setStatus] = useState('')
  async function reload() { const [u,g,a] = await Promise.all([api<User[]>('/users'),api<Group[]>('/groups'),api<Audit[]>('/audit')]); setUsers(u); setGroups(g); setAudit(a) }
  useEffect(() => { reload().catch(e => setStatus(errorText(e))) }, [])
  async function perform(action: () => Promise<unknown>, message: string) { try { await action(); await reload(); setStatus(message) } catch (e) { setStatus(errorText(e)) } }
  return <div className="stack"><div className="two-column"><section className="surface"><SectionTitle label="Người dùng" count={users.length} /><div className="form-grid"><label>Tên đăng nhập<input value={username} onChange={e => setUsername(e.target.value)} /></label><label>Mật khẩu<input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label><label>Vai trò<select value={role} onChange={e => setRole(e.target.value)}><option value="VIEWER">Viewer · xem</option><option value="ANALYST">Analyst · tạo/sửa</option><option value="ADMIN">Admin · quản trị</option></select></label><div className="form-end"><button className="primary-button" disabled={!username || !password} onClick={() => perform(async () => { await api('/users', 'POST', { username, password, role }); setUsername(''); setPassword('') }, 'Đã tạo người dùng.')}>Tạo người dùng</button></div></div><div className="subsection">{users.map(u => <div className="list-row" key={u.id}><strong>{u.username}</strong><span className="tag">{u.role}</span></div>)}</div></section>
    <section className="surface"><SectionTitle label="Nhóm" count={groups.length} /><div className="inline-form"><label>Tên nhóm<input value={groupName} onChange={e => setGroupName(e.target.value)} /></label><button className="primary-button" disabled={!groupName} onClick={() => perform(async () => { await api('/groups', 'POST', { name: groupName }); setGroupName('') }, 'Đã tạo nhóm.')}>Tạo nhóm</button></div><div className="inline-form"><label>Nhóm<select value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">Chọn nhóm</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>Người dùng<select value={userId} onChange={e => setUserId(e.target.value)}><option value="">Chọn người dùng</option>{users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}</select></label><button className="secondary-button" disabled={!groupId || !userId} onClick={() => perform(() => api(`/groups/${groupId}/members`, 'POST', { userId }), 'Đã thêm thành viên.')}>Thêm</button></div><div className="subsection">{groups.map(g => <div className="list-row" key={g.id}><strong>{g.name}</strong><small>{g.members?.length || 0} thành viên</small></div>)}</div></section></div>{status && <div className="notice">{status}</div>}
    <section className="surface"><SectionTitle label="Nhật ký thao tác" count={audit.length} /><div className="table-scroll"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th></tr></thead><tbody>{audit.map(a => <tr key={a.id}><td>{new Date(a.created_at).toLocaleString('vi-VN')}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.object_type}</td></tr>)}</tbody></table></div></section></div>
}
