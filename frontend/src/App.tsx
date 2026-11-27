import { Alert, Badge, Button, Input, SurfaceDialog } from './components/ui/primitives'
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, ArrowUpRight, ChartColumn, Check, ChevronRight, Database, FileUp, House, LayoutDashboard, LogOut, MessageSquare, Search, ShieldCheck, Sparkles, Table2, Terminal, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from './api'
import type { Actor, Chart, Connection, Dashboard, Dataset } from './api'
import { ConnectionsPage, DatasetsPage, SqlPage, ChartsPage, SecurityPage } from './screens'
import { DashboardsPage, PublicDashboard } from './dashboards'
import { ImportsPage } from './imports'
import { analysisPrompts, ChatPage } from './chat'
import { Empty, SectionTitle } from './ui'

type Page = 'overview' | 'imports' | 'connections' | 'datasets' | 'sql' | 'charts' | 'dashboards' | 'chat' | 'security'

const nav: Record<Page, { label: string; icon: LucideIcon }> = {
  overview: { label: 'Tổng quan', icon: House },
  chat: { label: 'Chat AI', icon: MessageSquare },
  imports: { label: 'Tải file & phân tích', icon: FileUp },
  connections: { label: 'Kết nối dữ liệu', icon: Database },
  datasets: { label: 'Datasets', icon: Table2 },
  sql: { label: 'SQL Lab', icon: Terminal },
  charts: { label: 'Chart Builder', icon: ChartColumn },
  dashboards: { label: 'Dashboards', icon: LayoutDashboard },
  security: { label: 'Bảo mật & nhật ký', icon: ShieldCheck },
}

const navigationGroups: { label?: string; pages: Page[] }[] = [
  { pages: ['overview', 'chat'] },
  { label: 'Dữ liệu', pages: ['imports', 'connections', 'datasets', 'sql'] },
  { label: 'Báo cáo', pages: ['charts', 'dashboards'] },
  { label: 'Quản trị', pages: ['security'] },
]

const descriptions: Record<Page, string> = {
  overview: 'Từ file CSV hoặc nguồn PostgreSQL đến phân tích và dashboard.',
  imports: 'Tải CSV, kiểm tra chất lượng dữ liệu và tạo dashboard tự động.',
  connections: 'Kiểm tra và quản lý nguồn PostgreSQL dùng để phân tích.',
  datasets: 'Tạo lớp dữ liệu trung gian từ bảng vật lý hoặc câu truy vấn.',
  sql: 'Soạn và chạy câu SELECT trong một giao diện có giới hạn truy vấn.',
  charts: 'Chọn chiều dữ liệu, phép tổng hợp và dạng biểu đồ.',
  dashboards: 'Sắp xếp biểu đồ, lọc dữ liệu và chia sẻ bản xem.',
  chat: 'Hỏi đáp dữ liệu bằng ngôn ngữ tự nhiên với AI.',
  security: 'Quản lý người dùng, nhóm và xem lịch sử thao tác.'
}

export default function App() {
  const share = new URLSearchParams(window.location.search).get('share')
  const [token, setToken] = useState(() => sessionStorage.getItem('bi_poc_token'))
  const [actor, setActor] = useState<Actor | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [dashboardTarget, setDashboardTarget] = useState('')
  const [chatDashboardTarget, setChatDashboardTarget] = useState('')
  const [chatDraft, setChatDraft] = useState('')
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
    if (!window.dispatchEvent(new Event('bi-poc-before-navigate', { cancelable: true }))) return
    try { await api('/auth/logout', 'POST') } catch { /* clear local session anyway */ }
    sessionStorage.removeItem('bi_poc_token'); setToken(null); setActor(null)
  }
  function done(message: string) { setNotice(message); reload().catch(error => setNotice(error.message)) }

  function go(next: Page, target = '', embeddedDashboard = '') {
    if (page !== next && !window.dispatchEvent(new Event('bi-poc-before-navigate', { cancelable: true }))) return
    if (next === 'chat' && page !== next) { setChatDraft(target); setChatDashboardTarget(embeddedDashboard) }
    if (next === 'dashboards' && page !== next) setDashboardTarget(target)
    setPage(next)
    setNotice('')
  }

  if (share) return <PublicDashboard token={share} />
  if (!token || !actor) return <Login onLogin={login} />
  const active = nav[page]
  const PageIcon = active.icon
  return <div className="app-shell">
    <a className="workspace-skip" href="#workspace-content">Đến nội dung</a>
    <aside className="sidebar workspace-rail">
      <Button variant="plain" className="brand workspace-brand" onClick={() => go('overview')}>
        <span className="brand-mark" aria-hidden="true">P</span>
        <span><strong>Pythera</strong><small>Data Studio</small></span>
      </Button>
      <nav aria-label="Điều hướng chính">{navigationGroups
        .filter(group => group.label !== 'Quản trị' || actor.role === 'ADMIN')
        .map(group => <div className="workspace-nav-group" key={group.label ?? 'main'}>
          {group.label && <span className="workspace-nav-label">{group.label}</span>}
          {group.pages.map(item => {
            const { label, icon: Icon } = nav[item]
            return <Button variant="plain" key={item} className={page === item ? 'nav-item active' : 'nav-item'}
              aria-current={page === item ? 'page' : undefined} onClick={() => go(item)}>
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span>
            </Button>
          })}
        </div>)}</nav>
      <div className="workspace-foot workspace-profile"><span className="avatar" aria-hidden="true">{actor.username.slice(0, 1).toUpperCase()}</span>
        <span><strong>{actor.username}</strong><small>{actor.role}</small></span>
        <Button variant="plain" className="workspace-logout" onClick={logout} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={16} aria-hidden="true" /></Button>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar workspace-topbar">
        <div className="workspace-path"><span>Không gian làm việc</span><ChevronRight size={14} aria-hidden="true" /><strong>{active.label}</strong></div>
        <div className="account"><QuickNavigation admin={actor.role === 'ADMIN'} onNavigate={go} />
          <span title={actor.username + ' · ' + actor.role} className="avatar" aria-label={actor.username}>{actor.username.slice(0, 1).toUpperCase()}</span>
        </div>
      </header>
      <main id="workspace-content" tabIndex={-1} className={`main-content workspace-content workspace-${page}`}>
        <header className="page-heading workspace-heading">
          <div className="page-title"><span className="screen-icon"><PageIcon size={23} aria-hidden="true" /></span>
            <div><h1>{active.label}</h1><p>{descriptions[page]}</p></div>
          </div>
        </header>
        {notice && <Alert className="workspace-notice" role="status">{notice}<Button variant="ghost" size="icon" onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={16} aria-hidden="true" /></Button></Alert>}
        {actor.role === 'VIEWER' && <Alert className="workspace-notice" role="status">Chế độ chỉ xem: tài khoản này không thể tạo, sửa hoặc xóa dữ liệu.</Alert>}
        {page === 'overview' && <Overview counts={[connections.length, datasets.length, charts.length, dashboards.length]} go={go} dashboards={dashboards} canEdit={actor.role !== 'VIEWER'} />}
        {page === 'imports' && <ImportsPage canEdit={actor.role !== 'VIEWER'} done={done} openDashboard={id => go('dashboards', id)} />}
        {page === 'connections' && <ConnectionsPage connections={connections} done={done} />}
        {page === 'datasets' && <DatasetsPage connections={connections} datasets={datasets} done={done} />}
        {page === 'sql' && <SqlPage connections={connections} done={done} />}
        {page === 'charts' && <ChartsPage canEdit={actor.role !== 'VIEWER'} datasets={datasets} charts={charts} done={done} />}
        {page === 'dashboards' && <DashboardsPage datasets={datasets} canEdit={actor.role !== 'VIEWER'} dashboards={dashboards} charts={charts} done={done}
          initialId={dashboardTarget} onOpenInChat={id => go('chat', '', id)} />}
        {page === 'chat' && <ChatPage datasets={datasets} charts={charts} dashboards={dashboards} canEdit={actor.role !== 'VIEWER'} done={done}
          initialDraft={chatDraft} initialDashboardId={chatDashboardTarget} />}
        {page === 'security' && <SecurityPage />}
      </main>
    </div>
  </div>
}

function QuickNavigation({ admin, onNavigate }: { admin: boolean; onNavigate: (page: Page) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || document.querySelector('[aria-modal="true"]')) return
      event.preventDefault(); setQuery(''); setOpen(true)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  const items = navigationGroups.flatMap(group => group.pages)
    .filter(item => (admin || item !== 'security') && nav[item].label.toLocaleLowerCase('vi-VN').includes(query.trim().toLocaleLowerCase('vi-VN')))
  return <>
    <Button variant="outline" className="workspace-search" type="button" onClick={() => { setQuery(''); setOpen(true) }}>
      <Search size={16} aria-hidden="true" /> Tìm mục <kbd>Ctrl K</kbd>
    </Button>
    {open && <SurfaceDialog title="Đi đến chức năng" className="workspace-search-dialog" onClose={() => setOpen(false)}>
      <Input value={query} onChange={event => setQuery(event.target.value)} aria-label="Tìm chức năng" placeholder="Nhập tên mục…" autoFocus />
      <div className="workspace-search-results">{items.map(item => {
        const { label, icon: Icon } = nav[item]
        return <Button variant="ghost" key={item} onClick={() => { setOpen(false); onNavigate(item) }}><Icon size={16} aria-hidden="true" /> {label}</Button>
      })}</div>
      {!items.length && <p role="status">Không tìm thấy mục phù hợp.</p>}
    </SurfaceDialog>}
  </>
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
  return <main className="login-layout">
    <section className="login-editorial">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">P</span><div><strong>Pythera</strong><small>Data Studio</small></div></div>
      <div className="login-story"><span className="eyebrow">NỀN TẢNG PHÂN TÍCH DỮ LIỆU</span>
        <h1>Biến dữ liệu thành<br /><em>quyết định rõ ràng.</em></h1>
        <p>Tải CSV hoặc kết nối PostgreSQL, phân tích dữ liệu và trình bày bằng dashboard.</p>
        <ul>{['Kết nối và quản lý dữ liệu', 'Phân tích bằng Chat AI', 'Tạo biểu đồ và dashboard', 'Kiểm chứng kết quả phân tích'].map(item => <li key={item}><Check size={16} aria-hidden="true" />{item}</li>)}</ul>
      </div>
      <div className="login-footer">Pythera · POC · 2026 <span>Spring Boot / PostgreSQL</span></div>
    </section>
    <section className="login-form-side">
      <form className="login-form" onSubmit={submit}>
        <span className="screen-icon"><ShieldCheck size={23} aria-hidden="true" /></span>
        <h2>Chào mừng trở lại</h2><p>Truy cập không gian phân tích dữ liệu.</p>
        <label>Tên đăng nhập<Input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required /></label>
        <label>Mật khẩu<Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        <Button className="primary-button full" disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Đăng nhập'}</Button>
        <small>Tài khoản demo được ghi trong README của dự án.</small>
      </form>
    </section>
  </main>
}

const overviewMetrics = [
  { label: 'Nguồn dữ liệu', page: 'connections', icon: Database },
  { label: 'Datasets', page: 'datasets', icon: Table2 },
  { label: 'Biểu đồ', page: 'charts', icon: ChartColumn },
  { label: 'Dashboards', page: 'dashboards', icon: LayoutDashboard },
] as const

function Overview({ counts, go, dashboards, canEdit }: { counts: number[]; go: (page: Page, target?: string) => void; dashboards: Dashboard[]; canEdit: boolean }) {
  return <div className="overview">
    {canEdit && <section className="overview-hero" aria-label="Bắt đầu phân tích">
      <div className="overview-intro">
        <span className="overview-spark" aria-hidden="true"><Sparkles size={21} /></span>
        <h2>Phân tích dữ liệu bằng Chat AI</h2>
        <p>Chọn dataset, đặt câu hỏi và xem biểu đồ, bảng số liệu ngay trong hội thoại.</p>
        <div className="overview-actions">
          <Button variant="plain" className="overview-chat-button" onClick={() => go('chat')}>Mở Chat AI <ArrowRight size={17} aria-hidden="true" /></Button>
          <Button variant="plain" className="overview-import-button" onClick={() => go('imports')}><FileUp size={17} aria-hidden="true" /> Tải file CSV</Button>
        </div>
      </div>
      <div className="overview-prompts">
        <h3>Bắt đầu với một câu hỏi</h3>
        {analysisPrompts.map(({ label, question, icon: Icon }) => <Button variant="plain" key={label} onClick={() => go('chat', question)}>
          <Icon size={17} aria-hidden="true" /><span>{label}</span><ArrowUpRight size={16} aria-hidden="true" />
        </Button>)}
      </div>
    </section>}
    <section className="overview-metrics" aria-label="Tài nguyên hiện có">
      {overviewMetrics.map(({ label, page, icon: Icon }, index) => <Button variant="plain" className="overview-metric" key={page} onClick={() => go(page)}>
        <span><Icon size={17} aria-hidden="true" /> {label}</span>
        <strong>{counts[index].toLocaleString('vi-VN')}</strong>
        <ArrowUpRight size={15} aria-hidden="true" className="overview-metric-arrow" />
      </Button>)}
    </section>
    <section className="overview-recent" aria-label="Dashboard gần đây">
      <div className="overview-recent-head"><SectionTitle label="Dashboard gần đây" />
        <Button variant="ghost" size="sm" className="text-link" onClick={() => go('dashboards')}>Xem tất cả <ArrowRight size={14} aria-hidden="true" /></Button>
      </div>
      {dashboards.length ? dashboards.slice(0, 4).map(item => <Button variant="plain" className="overview-dashboard" key={item.id} onClick={() => go('dashboards', item.id)}>
        <span className="overview-dashboard-icon"><LayoutDashboard size={17} aria-hidden="true" /></span>
        <strong>{item.name}</strong><Badge>{item.chart_count} biểu đồ</Badge><ArrowUpRight size={16} aria-hidden="true" />
      </Button>) : <Empty title="Chưa có dashboard" text="Bạn có thể tạo dashboard từ Chat AI hoặc Chart Builder." />}
    </section>
  </div>
}
