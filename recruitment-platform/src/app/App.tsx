import { useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { DEMO_USERS } from '@/data/demo';
import { can, ROLE_LABEL } from '@/domain/permissions';
import { Icon } from '@/ui/kit';
import { Admin } from '@/screens/Admin';
import { AssessmentReport } from '@/screens/AssessmentReport';
import { Candidates, CandidateProfile } from '@/screens/Candidates';
import { Compare } from '@/screens/Compare';
import { Dashboard } from '@/screens/Dashboard';
import { MandateDetail, MandateForm, Mandates, RoleIntelligence } from '@/screens/Mandates';
import { Reports } from '@/screens/Reports';
import { Screening } from '@/screens/Screening';
import { Upload } from '@/screens/Upload';
import { IS_CLOUD, useRuntime } from './runtime';

const NAV: { to: string; label: string; icon: string; need?: Parameters<typeof can>[1] }[] = [
  { to: '/dashboard', label: 'Executive Dashboard', icon: 'dashboard' },
  { to: '/mandates', label: 'Hiring Mandates', icon: 'mandate' },
  { to: '/role-intelligence', label: 'AI Role Intelligence', icon: 'brain' },
  { to: '/candidates', label: 'Candidate Database', icon: 'people' },
  { to: '/upload', label: 'CV Upload & Processing', icon: 'upload' },
  { to: '/screening', label: 'AI Screening', icon: 'screen' },
  { to: '/compare', label: 'Candidate Comparison', icon: 'compare' },
  { to: '/reports', label: 'Reports & Analytics', icon: 'report' },
  { to: '/admin', label: 'Settings & Administration', icon: 'admin', need: 'config.manage' },
];

function Login(): ReactNode {
  const rt = useRuntime();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  const brand = (
    <div className="row" style={{ marginBottom: 14 }}>
      <img src="/favicon.svg" width={40} height={40} alt="" />
      <div><h1 style={{ color: 'var(--gold)' }}>Recruitment Intelligence</h1><span className="muted small">Mandates · evidence-based screening · governance</span></div>
    </div>
  );

  if (!IS_CLOUD) {
    return (
      <div className="login"><div className="card stack">
        {brand}
        <div className="callout info small"><b>Local demo mode.</b> Everything stays in this browser; no account, no server. Sign in as a role to explore what each can see and do.</div>
        <div className="stack">
          {DEMO_USERS.map((u) => (
            <button key={u.id} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => rt.signInDemo(u.id)}>
              <span>{u.name.replace(/\s*\(.*\)/, '')}</span><span className="muted small">{ROLE_LABEL[u.role]}{u.entityIds.length ? ` · ${u.entityIds.length} entit${u.entityIds.length > 1 ? 'ies' : 'y'}` : ' · all entities'}</span>
            </button>
          ))}
        </div>
      </div></div>
    );
  }

  const submit = async (mode: 'in' | 'up'): Promise<void> => {
    setBusy(true); setMsg(undefined);
    const err = mode === 'in' ? await rt.signIn(email, pw) : await rt.signUp(email, pw);
    setBusy(false);
    setMsg(err ?? (mode === 'up' ? 'Account created. If email confirmation is on, check your inbox; then sign in.' : undefined));
  };
  return (
    <div className="login"><form className="card stack" onSubmit={(e) => { e.preventDefault(); void submit('in'); }}>
      {brand}
      {rt.awaitingActivation && <div className="callout warn small"><b>Awaiting activation.</b> You are signed in, but an administrator has not activated your account or assigned your business entities yet.</div>}
      <div className="field"><label htmlFor="em">Work email</label><input id="em" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} /></div>
      {msg && <div className="callout bad small" role="alert">{msg}</div>}
      <div className="row"><button className="btn primary" disabled={busy} type="submit">Sign in</button><button className="btn" type="button" disabled={busy || pw.length < 8 || !email} onClick={() => void submit('up')}>Create account</button>
        {rt.awaitingActivation && <button className="btn ghost" type="button" onClick={() => void rt.signOut()}>Sign out</button>}</div>
      <p className="muted small">New accounts start inactive until an administrator activates them and assigns business entities. You will be able to use the platform once that is done.</p>
    </form></div>
  );
}

export function App(): ReactNode {
  const rt = useRuntime();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  if (!rt.ready) return <div className="login"><p className="muted">Loading…</p></div>;
  if (!rt.user) return <Login />;
  const user = rt.user;
  const entityNames = user.role === 'admin' || user.role === 'super_admin' ? 'All entities' : rt.world.entities.map((e) => e.name).join(', ') || 'No entities assigned';

  return (
    <div className="shell">
      <aside className={`side${open ? ' open' : ''}`} aria-label="Main navigation">
        <div className="brand"><img src="/favicon.svg" width={34} height={34} alt="" /><b>Recruitment<br />Intelligence<span>Evidence-based screening</span></b></div>
        <nav className="nav" onClick={() => setOpen(false)}>
          {NAV.filter((n) => !n.need || can(user.role, n.need)).map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive || (n.to !== '/dashboard' && loc.pathname.startsWith(n.to)) ? 'active' : '')}><Icon name={n.icon} />{n.label}</NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div style={{ color: 'var(--gold-2)', fontWeight: 600 }}>{user.name.replace(/\s*\(.*\)/, '')}</div>
          <div className="muted">{ROLE_LABEL[user.role]}</div>
          <div className="muted" style={{ marginBottom: 8 }}>{entityNames}</div>
          <button className="btn sm ghost" onClick={() => void rt.signOut()}>{rt.mode === 'local' ? 'Switch user' : 'Sign out'}</button>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <button className="btn sm menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu"><Icon name="menu" /></button>
          <div className="grow muted small">AI assists; recruiters decide. Statuses are internal screening outcomes, not hiring decisions.</div>
          <span className="tag-pill" title={rt.mode === 'local' ? 'Data is stored in this browser only' : 'Data is stored in your Supabase project'}>{rt.mode === 'local' ? 'Local demo' : 'Cloud'}</span>
          <span className="tag-pill" title="Active AI engine">{rt.aiMode === 'claude' ? 'Claude' : 'Offline rules'}</span>
        </header>
        <main className="page">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/mandates" element={<Mandates />} />
            <Route path="/mandates/new" element={<MandateForm />} />
            <Route path="/mandates/:id" element={<MandateDetail />} />
            <Route path="/role-intelligence" element={<RoleIntelligence />} />
            <Route path="/candidates" element={<Candidates />} />
            <Route path="/candidates/:id" element={<CandidateProfile />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/screening" element={<Screening />} />
            <Route path="/assessments/:id" element={<AssessmentReport />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/admin" element={can(user.role, 'config.manage') ? <Admin /> : <Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
