import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { Actor, Chart, Connection, Dashboard, Dataset } from './api'
import { ConnectionsPage, DatasetsPage, SqlPage, ChartsPage, SecurityPage } from './screens'
import { DashboardsPage, PublicDashboard } from './dashboards'
import { ImportsPage } from './imports'
import { Empty, SectionTitle } from './ui'

type Page = 'overview' | 'imports' | 'connections' | 'datasets' | 'sql' | 'charts' | 'dashboards' | 'security'

const nav: { id: Page; label: string; number: string }[] = [
  { id: 'overview', label: 'Tổng quan', number: '00' },
  { id: 'imports', label: 'Tải file & phân tích', number: '01' },
  { id: 'connections', label: 'Kết nối dữ liệu', number: '02' },
  { id: 'datasets', label: 'Datasets', number: '03' },
  { id: 'sql', label: 'SQL Lab', number: '04' },
  { id: 'charts', label: 'Chart Builder', number: '05' },
  { id: 'dashboards', label: 'Dashboards', number: '06' },
  { id: 'security', label: 'Bảo mật & nhật ký', number: '07' }
]

const descriptions: Record<Page, string> = {
  overview: 'Từ file CSV hoặc nguồn PostgreSQL đến phân tích và dashboard.',
  imports: 'Tải CSV, kiểm tra chất lượng dữ liệu và tạo dashboard tự động.',
  connections: 'Kiểm tra và quản lý nguồn PostgreSQL dùng để phân tích.',
  datasets: 'Tạo lớp dữ liệu trung gian từ bảng vật lý hoặc câu truy vấn.',
  sql: 'Soạn và chạy câu SELECT trong một giao diện có giới hạn truy vấn.',
  charts: 'Chọn chiều dữ liệu, phép tổng hợp và dạng biểu đồ.',
  dashboards: 'Sắp xếp biểu đồ, lọc dữ liệu và chia sẻ bản xem.',
  security: 'Quản lý người dùng, nhóm và xem lịch sử thao tác.'
}

export default function App() {
  const share = new URLSearchParams(window.location.search).get('share')
  const [token, setToken] = useState(() => sessionStorage.getItem('bi_poc_token'))
  const [actor, setActor] = useState<Actor | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [dashboardTarget, setDashboardTarget] = useState('')
  const [connections, setConnections] = useState<Connection[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [charts, setCharts] = useState<Chart[]>([])
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const logout = () => { setToken(null); setActor(null) }
    window.addEventListener('bi-poc-logout', logout)
    return () => window.removeEventListener('bi-poc-logout', logout)
  }, [])

  const reload = useCallback(async () => {
    const [c, d, h, b] = await Promise.all([
      api<Connection[]>('/connections'), api<Dataset[]>('/datasets'), api<Chart[]>('/charts'), api<Dashboard[]>('/dashboards')
    ])
    setConnections(c); setDatasets(d); setCharts(h); setDashboards(b)
  }, [])

  useEffect(() => {
    if (!token || share) return
    api<Actor>('/auth/me').then(user => { setActor(user); return reload() }).catch(error => setNotice(error.message))
  }, [token, share, reload])

  function login(value: string, user: Actor) {
    sessionStorage.setItem('bi_poc_token', value); setToken(value); setActor(user)
  }
  async function logout() {
    try { await api('/auth/logout', 'POST') } catch { /* clear local session anyway */ }
    sessionStorage.removeItem('bi_poc_token'); setToken(null); setActor(null)
  }
  function done(message: string) { setNotice(message); reload().catch(error => setNotice(error.message)) }

  if (share) return <PublicDashboard token={share} />
  if (!token || !actor) return <Login onLogin={login} />
  const active = nav.find(item => item.id === page)!
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">P</div><div><strong>Pythera</strong><span>Data Studio · POC</span></div></div>
      <div className="sidebar-label">KHÔNG GIAN LÀM VIỆC</div>
      <nav aria-label="Điều hướng chính">{nav.filter(item => item.id !== 'security' || actor.role === 'ADMIN').map(item =>
        <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(item.id); setNotice('') }}>
          <span className="nav-index">{item.number}</span><span>{item.label}</span>
        </button>)}</nav>
      <div className="sidebar-foot"><span className="live-dot" /> Chạy trên máy cục bộ <small>PostgreSQL · Spring Boot</small></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>PYTHERA AI LAB <b>/</b> {active.label.toUpperCase()}</span><div className="account"><span className="avatar">{actor.username.slice(0, 1).toUpperCase()}</span><span>{actor.username}<small>{actor.role}</small></span><button className="text-button" onClick={logout}>Đăng xuất</button></div></header>
      <main className="main-content">
        <div className="page-heading"><div><span className="eyebrow">BI DASHBOARD / BẢN THỬ NGHIỆM</span><h1>{active.label}</h1><p>{descriptions[page]}</p></div><span className="page-number">{active.number} / 07</span></div>
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Đóng thông báo">×</button></div>}
        {actor.role === 'VIEWER' && <div className="notice" role="status">Chế độ chỉ xem: tài khoản này không thể tạo, sửa hoặc xóa dữ liệu.</div>}
        {page === 'overview' && <Overview counts={[connections.length,datasets.length,charts.length,dashboards.length]} go={setPage} dashboards={dashboards} />}
        {page === 'imports' && <ImportsPage canEdit={actor.role !== 'VIEWER'} done={done} openDashboard={id => { setDashboardTarget(id); setPage('dashboards') }} />}
        {page === 'connections' && <ConnectionsPage connections={connections} done={done} />}
        {page === 'datasets' && <DatasetsPage connections={connections} datasets={datasets} done={done} />}
        {page === 'sql' && <SqlPage connections={connections} done={done} />}
        {page === 'charts' && <ChartsPage datasets={datasets} charts={charts} done={done} />}
        {page === 'dashboards' && <DashboardsPage dashboards={dashboards} charts={charts} done={done} initialId={dashboardTarget} />}
        {page === 'security' && <SecurityPage />}
      </main>
    </div>
  </div>
}

function Login({ onLogin }: { onLogin: (token: string, user: Actor) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const result = await api<{ token: string; user: Actor }>('/auth/login', 'POST', { username, password }); onLogin(result.token, result.user) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="login-layout"><section className="login-editorial"><div className="login-brand">P <span>PYTHERA AI LAB</span></div><div><span className="eyebrow">PHẦN MỀM KHAI THÁC DỮ LIỆU</span><h1>Biến dữ liệu thành<br /><em>quyết định rõ ràng.</em></h1><p>Tải CSV hoặc kết nối PostgreSQL, phân tích dữ liệu và trình bày bằng dashboard.</p></div><div className="login-footer">POC · 2026 <span>Spring Boot / PostgreSQL</span></div></section>
    <section className="login-form-side"><form className="login-form" onSubmit={submit}><span className="eyebrow">ĐĂNG NHẬP</span><h2>Chào mừng trở lại</h2><p>Truy cập không gian phân tích dữ liệu.</p><label>Tên đăng nhập<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required /></label><label>Mật khẩu<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button full" disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Đăng nhập'}</button><small>Tài khoản demo được ghi trong README của dự án.</small></form></section></div>
}

function Overview({ counts, go, dashboards }: { counts: number[]; go: (page: Page) => void; dashboards: Dashboard[] }) {
  return <div className="overview">
    <div className="metric-grid">{[['Nguồn dữ liệu',counts[0]],['Datasets',counts[1]],['Biểu đồ',counts[2]],['Dashboards',counts[3]]].map(([label,value]) => <div className="metric-tile" key={label}><span>{label}</span><strong>{value}</strong><small>Đã lưu trong bản demo</small></div>)}</div>
    <div className="overview-grid"><section className="surface flow-panel"><SectionTitle label="Luồng xử lý" /><p className="muted">Tải CSV để tạo dashboard tự động; hoặc kết nối PostgreSQL để tự xây dựng phân tích.</p><div className="flow-list">{[['01','Tải CSV','Kiểm tra định dạng và nhập dữ liệu'],['02','Phân tích','Đếm dòng, ô trống, sai kiểu và tổng số'],['03','Dataset','Bảng PostgreSQL hoặc câu SQL'],['04','Biểu đồ','Tạo tự động hoặc cấu hình thủ công'],['05','Dashboard','Sắp xếp, lọc và chia sẻ']].map(item => <div className="flow-row" key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small></div>)}</div><button className="secondary-button" onClick={() => go('imports')}>Tải CSV và xem phân tích <span>↗</span></button></section>
      <section className="surface latest-panel"><SectionTitle label="Dashboard gần đây" count={dashboards.length} />{dashboards.length ? dashboards.slice(0,4).map(item => <button className="list-row clickable" key={item.id} onClick={() => go('dashboards')}><span><strong>{item.name}</strong><small>{item.chart_count} biểu đồ</small></span><span className="row-arrow">↗</span></button>) : <Empty title="Chưa có dashboard" text="Tạo kết nối và biểu đồ để hoàn thiện luồng demo." />}<button className="text-link" onClick={() => go('dashboards')}>Mở khu vực dashboard ↗</button></section></div>
  </div>
}
