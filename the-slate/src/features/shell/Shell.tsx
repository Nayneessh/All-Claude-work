import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../data/api';
import { K, useNotifications, useSettings, useToday } from '../../data/hooks';
import { Icon } from '../../ui/kit';
import { useAuth } from '../auth/AuthProvider';
import { useIdleLogout, useReminderWatcher } from './watchers';
import { fmtDateTime } from '../../lib/time';
import { ENV } from '../../lib/env';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true }, { to: '/mandates', label: 'Mandates', icon: 'mandates' }, { to: '/talent', label: 'Talent Pool', icon: 'talent' },
  { to: '/slate', label: 'The Slate', icon: 'slate' }, { to: '/sop', label: 'SOP', icon: 'sop' }, { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Shell() {
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const loc = useLocation(); const nav = useNavigate(); const qc = useQueryClient();
  const { user, signOut } = useAuth(); const { settings } = useSettings(); const today = useToday();
  const notes = useNotifications();
  const unread = (notes.data ?? []).filter((n) => !n.read_at);
  const title = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label ?? '';
  const main = useRef<HTMLElement>(null);
  useIdleLogout(settings.idleLogoutMinutes, signOut);
  useReminderWatcher(settings.timezone, settings.notifyInApp);
  useEffect(() => { setOpen(false); setBell(false); main.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { document.documentElement.dataset.density = settings.density; }, [settings.density]);
  useEffect(() => { document.title = title ? `${title} · THE SLATE` : 'THE SLATE'; }, [title]);
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setBell(false); } }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, []);

  async function openNote(id: string, link: string | null) {
    await api.markRead([id]); qc.invalidateQueries({ queryKey: K.notifications }); setBell(false); if (link) nav(link);
  }
  return (
    <div className="shell">
      <header className="topbar">
        <button className="burger" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><span /></button>
        <div className="brand"><b>THE SLATE</b><small>COMMAND CENTRE</small></div>
        <span className="page-title">{title}</span>
        <div className="right row">
          <div style={{ position: 'relative' }}>
            <button className="icon-btn" aria-label={`Notifications${unread.length ? ` (${unread.length} unread)` : ''}`} onClick={() => setBell((b) => !b)}><Icon n="bell" />{unread.length > 0 && <span className="dot">{unread.length > 9 ? '9+' : unread.length}</span>}</button>
            {bell && (
              <div className="card" style={{ position: 'absolute', right: 0, top: 46, width: 'min(380px, 92vw)', maxHeight: '70vh', overflow: 'auto', zIndex: 70, boxShadow: 'var(--shadow)' }}>
                <div className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                  <b>Notifications</b>
                  {unread.length > 0 && <button className="btn xs" onClick={async () => { await api.markRead(unread.map((n) => n.id)); qc.invalidateQueries({ queryKey: K.notifications }); }}>Mark all read</button>}
                </div>
                {(notes.data ?? []).length === 0 && <div className="muted center" style={{ padding: 24 }}>You're all caught up.</div>}
                {(notes.data ?? []).slice(0, 25).map((n) => (
                  <button key={n.id} onClick={() => openNote(n.id, n.link)} style={{ all: 'unset', display: 'block', boxSizing: 'border-box', width: '100%', padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--line)', background: n.read_at ? 'none' : 'var(--gold-bg)' }}>
                    <div className="bold small">{n.title}</div>{n.body && <div className="small dim">{n.body}</div>}<div className="tiny muted">{fmtDateTime(n.created_at, settings.timezone)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="logo-slot" aria-label="Logo placeholder">YOUR LOGO HERE</div>
        </div>
      </header>
      {open && <>
        <div className="nav-scrim" onClick={() => setOpen(false)} />
        <nav className="nav" aria-label="Main">
          <div className="nav-head brand"><b>THE SLATE</b><small>ONE COMMAND CENTRE · COMPLETE CONTROL</small></div>
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setOpen(false)}><Icon n={n.icon} />{n.label}</NavLink>)}
          <div className="nav-foot stack-s">
            <div className="trunc" title={user?.email ?? ''}>{user?.email}</div>
            <div className="tiny">Today · {today} · v{ENV.appVersion}</div>
            <button className="btn sm" onClick={() => signOut()}><Icon n="out" size={15} /> Sign out</button>
          </div>
        </nav>
      </>}
      <main className="main" ref={main} tabIndex={-1} style={{ outline: 'none' }}><Outlet /></main>
    </div>
  );
}
