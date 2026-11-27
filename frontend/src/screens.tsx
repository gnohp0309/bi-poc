import { Alert, Badge, Button, Card, Input, NativeSelect, Table, Textarea } from './components/ui/primitives'
import { ArrowLeft, ClipboardList, Database, FolderTree, LockKeyhole, Play, Table2, Terminal, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import type { Chart, ChartData, Connection, Dataset, QueryResult } from './api'
import { ChartCanvas, DataTable, Empty, SectionTitle } from './ui'
import { ExplorationReportDialog } from './exploration'

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
  return <div className="two-column resource-workbench"><Card className="form-panel"><SectionTitle label="Thêm nguồn dữ liệu" icon={Database} /><p className="muted">POC hiện hỗ trợ PostgreSQL. Mật khẩu kết nối được mã hóa trong kho cấu hình.</p>
    <div className="form-grid"><label className="wide">Tên kết nối<Input value={form.name} onChange={e => field('name', e.target.value)} /></label><label>Máy chủ<Input value={form.host} onChange={e => field('host', e.target.value)} /></label><label>Cổng<Input type="number" value={form.port} onChange={e => field('port', e.target.value)} /></label><label>Tên CSDL<Input value={form.database} onChange={e => field('database', e.target.value)} /></label><label>Tài khoản<Input value={form.username} onChange={e => field('username', e.target.value)} /></label><label className="wide">Mật khẩu<Input type="password" value={form.password} onChange={e => field('password', e.target.value)} /></label></div>
    <div className="actions"><Button variant="outline" className="secondary-button" disabled={busy} onClick={() => act('/connections/test', false)}>Kiểm tra kết nối</Button><Button className="primary-button" disabled={busy} onClick={() => act('/connections', true)}>Lưu kết nối</Button></div>{status && <p className="inline-status">{status}</p>}</Card>
    <Card><SectionTitle label="Nguồn đã lưu" count={connections.length} />{connections.length ? connections.map(item => <div className="record" key={item.id}><div><strong>{item.name}</strong><small>{item.host}:{item.port} / {item.database_name} · {item.username}</small></div><div className="row-actions"><Button variant="ghost" size="sm" className="text-link" onClick={() => inspect(item.id)}>Xem bảng</Button><Button variant="destructive" size="sm" className="danger-link" onClick={() => remove(item)}>Xóa</Button></div></div>) : <Empty title="Chưa có nguồn" text="Lưu kết nối để tạo dataset và chạy truy vấn." />}
      {selected && <div className="subsection"><SectionTitle label="Bảng khả dụng" count={tables.length} />{tables.map(t => <div className="list-row" key={`${t.schema}.${t.table}`}><span>{t.schema}.{t.table}</span><span className="tag">TABLE</span></div>)}</div>}</Card></div>
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
  const [previewLoading, setPreviewLoading] = useState(false)
  const [exploring, setExploring] = useState(false)
  const [aliases, setAliases] = useState('{}')
  const [status, setStatus] = useState('')
  useEffect(() => { if (!connectionId && connections.length) setConnectionId(connections[0].id) }, [connections, connectionId])
  useEffect(() => { if (!connectionId) return; api<{ schema: string; table: string }[]>(`/connections/${connectionId}/tables`).then(items => { setTables(items); setSourceName(items.length ? `${items[0].schema}.${items[0].table}` : '') }).catch(e => setStatus(errorText(e))) }, [connectionId])
  async function save() { try { await api('/datasets', 'POST', { connectionId, kind, name, sourceName, sql }); setName(''); done('Đã tạo dataset.'); setStatus('') } catch (e) { setStatus(errorText(e)) } }
  async function show(item: Dataset) {
    setSelected(item); setAliases(item.aliases_json || '{}'); setPreview(null); setPreviewLoading(true); setStatus('')
    try { setPreview(await api(`/datasets/${item.id}/preview`)) }
    catch (e) { setStatus(errorText(e)) }
    finally { setPreviewLoading(false) }
  }
  async function saveAliases() { if (!selected) return; try { await api(`/datasets/${selected.id}/aliases`, 'PUT', { aliases: JSON.parse(aliases) }); done('Đã lưu tên cột thân thiện.'); setStatus('') } catch (e) { setStatus(errorText(e)) } }
  async function remove(item: Dataset) { if (!confirmRemove(item.name)) return; try { await api(`/datasets/${item.id}`, 'DELETE'); if (selected?.id === item.id) { setSelected(null); setPreview(null) }; done('Đã xóa dataset.') } catch (e) { setStatus(errorText(e)) } }
  if (selected) return <div className="stack">
    <div className="subview-heading"><div><h2>Xem trước dataset</h2><p>{selected.name}</p></div>
      <Button variant="outline" disabled={previewLoading} onClick={() => { setSelected(null); setStatus('') }}>
        <ArrowLeft size={16} aria-hidden="true" /> Quay lại Datasets
      </Button>
    </div>
    <Card className="dataset-preview">
      <div className="panel-head"><SectionTitle label={selected.name} icon={Table2} />
      <Button variant="soft" onClick={() => setExploring(true)}>Khám phá dataset</Button></div>
      {previewLoading ? <p role="status">Đang tải dữ liệu xem trước…</p> : status ? <Alert role="alert" tone="danger">{status}</Alert> : <DataTable result={preview} />}
      <details className="subsection"><summary>Tên cột thân thiện</summary>
        <label>Nhãn cột (JSON: tên cột → nhãn)<Textarea className="code-input" rows={3} value={aliases} onChange={e => setAliases(e.target.value)} /></label>
        <Button variant="outline" onClick={saveAliases}>Lưu nhãn cột</Button>
      </details>
    </Card>
    {exploring && <ExplorationReportDialog datasetId={selected.id} onClose={() => setExploring(false)} />}
  </div>
  return <div className="stack"><div className="two-column resource-workbench"><Card className="form-panel"><SectionTitle label="Tạo dataset" icon={Table2} /><div className="form-grid"><label className="wide">Nguồn kết nối<NativeSelect value={connectionId} onChange={e => { setConnectionId(e.target.value); setSql('') }}><option value="">Chọn kết nối</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></label><label className="wide">Tên dataset<Input value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Doanh thu theo đơn" /></label></div><div className="segmented"><Button variant="plain" aria-pressed={kind === 'PHYSICAL'} className={kind === 'PHYSICAL' ? 'selected' : ''} onClick={() => setKind('PHYSICAL')}>Bảng vật lý</Button><Button variant="plain" aria-pressed={kind === 'VIRTUAL'} className={kind === 'VIRTUAL' ? 'selected' : ''} onClick={() => setKind('VIRTUAL')}>SQL ảo</Button></div>{kind === 'PHYSICAL' ? <label>Bảng nguồn<NativeSelect value={sourceName} onChange={e => setSourceName(e.target.value)}>{tables.map(t => <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>{t.schema}.{t.table}</option>)}</NativeSelect></label> : <><label>Bảng tham khảo<NativeSelect value={sourceName} onChange={e => setSourceName(e.target.value)}><option value="">Chọn bảng</option>{tables.map(t => <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>{t.schema}.{t.table}</option>)}</NativeSelect></label><Button variant="outline" className="secondary-button" disabled={!sourceName} onClick={() => setSql(`SELECT * FROM ${sourceName}`)}>Chèn câu SELECT mẫu</Button><label>Câu truy vấn SELECT<Textarea className="code-input" rows={6} value={sql} onChange={e => setSql(e.target.value)} placeholder="Chọn bảng rồi chèn câu mẫu, hoặc tự viết SELECT có WHERE / GROUP BY" /></label><p className="hint">Bạn có thể chọn cột, lọc WHERE, tính SUM/COUNT và GROUP BY. Chỉ chấp nhận một câu SELECT/WITH đọc dữ liệu.</p></>}<div className="actions"><Button className="primary-button" disabled={!connectionId || !name.trim() || (kind === 'VIRTUAL' ? !sql.trim() : !sourceName)} onClick={save}>Tạo dataset</Button></div>{status && <p className="inline-status">{status}</p>}</Card>
    <Card><SectionTitle label="Danh sách dataset" count={datasets.length} />{datasets.length ? datasets.map(item => <div className="record" key={item.id}><div><strong>{item.name}</strong><small>{item.kind === 'PHYSICAL' ? 'Bảng vật lý' : 'SQL ảo'} · {item.connection_name}</small></div><div className="row-actions"><Button variant="ghost" size="sm" className="text-link" onClick={() => show(item)}>Xem trước</Button><Button variant="destructive" size="sm" className="danger-link" onClick={() => remove(item)}>Xóa</Button></div></div>) : <Empty title="Chưa có dataset" text="Chọn một bảng hoặc câu SQL làm lớp dữ liệu trung gian." />}</Card></div>
    </div>
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
  return <div className="two-column wide-left sql-workbench"><div className="stack"><Card>
    <div className="panel-head"><SectionTitle label="Trình soạn SQL" icon={Terminal} /><Badge tone="positive"><LockKeyhole size={12} aria-hidden="true" /> Chỉ đọc</Badge></div>
    <label>Kết nối<NativeSelect value={connectionId} onChange={e => setConnectionId(e.target.value)}><option value="">Chọn kết nối</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></label>
    <label>Câu truy vấn<Textarea className="code-input editor" spellCheck={false} value={sql} onChange={e => setSql(e.target.value)} /></label>
    <div className="actions"><Button disabled={!connectionId || busy} onClick={run}><Play size={15} aria-hidden="true" />{busy ? 'Đang chạy…' : 'Chạy truy vấn'}</Button></div>
    <p className="hint">Câu mẫu public.orders dùng kết nối PostgreSQL · Bán hàng mẫu. Chỉ một lệnh SELECT/WITH; tối đa 500 dòng và 6 giây.</p>
    {status && <Alert className="sql-status" role="status" tone={status === 'Truy vấn thành công.' ? 'positive' : 'danger'}>{status}</Alert>}
    </Card><Card><SectionTitle label="Kết quả truy vấn" count={result?.rows.length} icon={Table2} /><DataTable result={result} /></Card></div>
    <Card><SectionTitle label="Truy vấn đã lưu" count={saved.length} icon={ClipboardList} /><label>Tên truy vấn<Input value={name} onChange={e => setName(e.target.value)} placeholder="Báo cáo doanh thu tháng" /></label><Button variant="outline" className="secondary-button" disabled={!name.trim() || !connectionId} onClick={save}>Lưu để dùng lại</Button><div className="subsection">{saved.length ? saved.map(item => <Button variant="plain" className="list-row clickable full-row" key={item.id} onClick={() => { setConnectionId(item.connection_id); setSql(item.sql_text) }}><span><strong>{item.name}</strong><small>{item.sql_text.slice(0, 70)}</small></span><span>↗</span></Button>) : <Empty title="Chưa lưu truy vấn" text="Lưu SQL để mở lại khi trình bày." />}</div></Card>
  </div>
}

export { ChartsPage } from './chart-builder'

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
  const [view, setView] = useState<'access' | 'audit'>('access')
  const [actorFilter, setActorFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [objectFilter, setObjectFilter] = useState('')
  const shownAudit = audit.filter(entry => (!actorFilter || entry.actor === actorFilter) &&
    (!actionFilter || entry.action === actionFilter) && (!objectFilter || entry.object_type === objectFilter))
  async function reload() { const [u,g,a] = await Promise.all([api<User[]>('/users'),api<Group[]>('/groups'),api<Audit[]>('/audit')]); setUsers(u); setGroups(g); setAudit(a) }
  useEffect(() => { reload().catch(e => setStatus(errorText(e))) }, [])
  async function perform(action: () => Promise<unknown>, message: string) { try { await action(); await reload(); setStatus(message) } catch (e) { setStatus(errorText(e)) } }
  return <div className="stack">
    <div className="ui-tabs-list" role="group" aria-label="Mục quản trị">
      <Button variant="plain" className="ui-tabs-trigger" data-state={view === 'access' ? 'active' : 'inactive'} aria-pressed={view === 'access'} onClick={() => setView('access')}>Người dùng & nhóm</Button>
      <Button variant="plain" className="ui-tabs-trigger" data-state={view === 'audit' ? 'active' : 'inactive'} aria-pressed={view === 'audit'} onClick={() => setView('audit')}>Nhật ký thao tác</Button>
    </div>
    {view === 'access' ? <><div className="two-column resource-workbench"><Card><SectionTitle label="Người dùng" count={users.length} icon={Users} /><div className="form-grid"><label>Tên đăng nhập<Input value={username} onChange={e => setUsername(e.target.value)} /></label><label>Mật khẩu<Input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label><label>Vai trò<NativeSelect value={role} onChange={e => setRole(e.target.value)}><option value="VIEWER">Viewer · xem</option><option value="ANALYST">Analyst · tạo/sửa</option><option value="ADMIN">Admin · quản trị</option></NativeSelect></label><div className="form-end"><Button className="primary-button" disabled={!username || !password} onClick={() => perform(async () => { await api('/users', 'POST', { username, password, role }); setUsername(''); setPassword('') }, 'Đã tạo người dùng.')}>Tạo người dùng</Button></div></div><div className="subsection">{users.map(u => <div className="list-row" key={u.id}><strong>{u.username}</strong><Badge tone={u.role === 'ADMIN' ? 'positive' : 'neutral'}>{u.role}</Badge></div>)}</div></Card>
    <Card><SectionTitle label="Nhóm" count={groups.length} icon={FolderTree} /><div className="inline-form"><label>Tên nhóm<Input value={groupName} onChange={e => setGroupName(e.target.value)} /></label><Button className="primary-button" disabled={!groupName} onClick={() => perform(async () => { await api('/groups', 'POST', { name: groupName }); setGroupName('') }, 'Đã tạo nhóm.')}>Tạo nhóm</Button></div><div className="inline-form"><label>Nhóm<NativeSelect value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">Chọn nhóm</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</NativeSelect></label><label>Người dùng<NativeSelect value={userId} onChange={e => setUserId(e.target.value)}><option value="">Chọn người dùng</option>{users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}</NativeSelect></label><Button variant="outline" className="secondary-button" disabled={!groupId || !userId} onClick={() => perform(() => api(`/groups/${groupId}/members`, 'POST', { userId }), 'Đã thêm thành viên.')}>Thêm</Button></div><div className="subsection">{groups.length ? groups.map(g => <div className="list-row" key={g.id}><strong>{g.name}</strong><small>{g.members?.length || 0} thành viên</small></div>) : <Empty title="Chưa có nhóm" text="Tạo nhóm để quản lý thành viên." />}</div></Card></div>
    <Card className="audit-summary"><SectionTitle label="Nhật ký thao tác" count={audit.length} icon={ClipboardList} />
      <Button variant="outline" onClick={() => setView('audit')}>Xem nhật ký</Button>
    </Card></> :
    <Card><SectionTitle label="Lịch sử thao tác" count={shownAudit.length} icon={ClipboardList} />
      <div className="audit-filters">
        {([
          ['Người thực hiện', 'actor', actorFilter, setActorFilter],
          ['Hành động', 'action', actionFilter, setActionFilter],
          ['Đối tượng', 'object_type', objectFilter, setObjectFilter],
        ] as const).map(([label, field, filter, setFilter]) => <label key={field}>{label}
          <NativeSelect value={filter} onChange={e => setFilter(e.target.value)}><option value="">Tất cả</option>
            {[...new Set(audit.map(entry => entry[field]))].sort().map(value => <option key={value}>{value}</option>)}
          </NativeSelect>
        </label>)}
      </div>
      <div className="table-scroll audit-table" role="region" aria-label="Nhật ký thao tác" tabIndex={0}><Table><thead><tr><th scope="col">Thời gian</th><th scope="col">Người thực hiện</th><th scope="col">Hành động</th><th scope="col">Đối tượng</th></tr></thead><tbody>{shownAudit.map(a => <tr key={a.id}><td>{new Date(a.created_at).toLocaleString('vi-VN')}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.object_type}</td></tr>)}</tbody></Table></div>
      {!shownAudit.length && <Empty title="Chưa có bản ghi phù hợp" text="Kiểm tra lựa chọn bộ lọc." />}
    </Card>}
    {status && <Alert role="status">{status}</Alert>}
  </div>
}
