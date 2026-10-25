import { lazy, Suspense, useEffect } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { HashRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './AppContext';
import { UiProvider, Loading, Button, Banner } from '@/ui/kit';
import { Icon, type IconName } from '@/ui/icons';
import { handleBack } from './back';
import { exitApp, watchApp } from '@/services/platform';
import { Today } from '@/screens/Today';
import { Workout } from '@/screens/Workout';
import { Auth, RecoverPassword } from '@/screens/Auth';
import { Onboarding } from '@/screens/Onboarding';
import { AppLock } from './AppLock';

const lazyScreen = <T extends Record<string, React.ComponentType>>(loader: () => Promise<T>, name: keyof T) => lazy(async () => ({ default: (await loader())[name] as React.ComponentType }));
const WorkoutSummary = lazyScreen(() => import('@/screens/WorkoutSummary'), 'WorkoutSummary');
const Programs = lazyScreen(() => import('@/screens/Programs'), 'Programs');
const ProgramDetail = lazyScreen(() => import('@/screens/Programs'), 'ProgramDetail');
const DayEditor = lazyScreen(() => import('@/screens/DayEditor'), 'DayEditor');
const Exercises = lazyScreen(() => import('@/screens/Exercises'), 'Exercises');
const ExerciseDetail = lazyScreen(() => import('@/screens/Exercises'), 'ExerciseDetail');
const ExerciseForm = lazyScreen(() => import('@/screens/Exercises'), 'ExerciseForm');
const History = lazyScreen(() => import('@/screens/History'), 'History');
const SessionDetail = lazyScreen(() => import('@/screens/SessionDetail'), 'SessionDetail');
const Compare = lazyScreen(() => import('@/screens/SessionDetail'), 'Compare');
const Progress = lazyScreen(() => import('@/screens/Progress'), 'Progress');
const Drill = lazyScreen(() => import('@/screens/Drill'), 'Drill');
const Reports = lazyScreen(() => import('@/screens/Reports'), 'Reports');
const Suggestions = lazyScreen(() => import('@/screens/Reports'), 'Suggestions');
const More = lazyScreen(() => import('@/screens/More'), 'More');
const Recovery = lazyScreen(() => import('@/screens/Recovery'), 'Recovery');
const Body = lazyScreen(() => import('@/screens/Recovery'), 'Body');
const Goals = lazyScreen(() => import('@/screens/Goals'), 'Goals');
const Settings = lazyScreen(() => import('@/screens/Settings'), 'Settings');
const Backup = lazyScreen(() => import('@/screens/Backup'), 'Backup');
const SyncStatus = lazyScreen(() => import('@/screens/Backup'), 'SyncStatus');
const Search = lazyScreen(() => import('@/screens/Search'), 'Search');

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Today', icon: 'today' }, { to: '/program', label: 'Program', icon: 'program' }, { to: '/history', label: 'History', icon: 'history' },
  { to: '/progress', label: 'Progress', icon: 'chart' }, { to: '/more', label: 'More', icon: 'more' },
];
/** Fetch every lazy screen once the app is idle, so the web build keeps working when the network drops mid-workout. */
const SCREEN_LOADERS: (() => Promise<unknown>)[] = [
  () => import('@/screens/WorkoutSummary'), () => import('@/screens/Programs'), () => import('@/screens/DayEditor'), () => import('@/screens/Exercises'),
  () => import('@/screens/History'), () => import('@/screens/SessionDetail'), () => import('@/screens/Progress'), () => import('@/screens/Drill'),
  () => import('@/screens/Reports'), () => import('@/screens/More'), () => import('@/screens/Recovery'), () => import('@/screens/Goals'),
  () => import('@/screens/Settings'), () => import('@/screens/Backup'), () => import('@/screens/Search'),
];
function preloadScreens(): void {
  const run = (): void => { void Promise.allSettled(SCREEN_LOADERS.map((l) => l())).then(() => { document.documentElement.dataset.screensReady = '1'; }); };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(run, { timeout: 3000 }); else window.setTimeout(run, 1500);
}
const ROOTS = new Set(TABS.map((t) => t.to));

function Shell() {
  const loc = useLocation();
  const hideNav = /^\/workout\//.test(loc.pathname) || /^\/(auth|onboarding)/.test(loc.pathname);
  return (
    <div className="app">
      <ErrorBoundary resetKey={loc.pathname}><Suspense fallback={<div className="screen"><Loading /></div>}><Outlet /></Suspense></ErrorBoundary>
      {!hideNav && (
        <nav className="nav" aria-label="Main">
          {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive || (t.to !== '/' && loc.pathname.startsWith(t.to)) ? 'active' : '')}><Icon name={t.icon} /><span>{t.label}</span></NavLink>)}
        </nav>
      )}
    </div>
  );
}

function BackHandler() {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    let off: (() => void) | undefined;
    void watchApp({
      onBack: () => {
        if (handleBack()) return;                               // close the top-most sheet/dialog first
        if (ROOTS.has(loc.pathname)) { if (loc.pathname === '/') void exitApp(); else nav('/'); return; }
        if (window.history.length > 1) nav(-1); else nav('/');
      },
    }).then((f) => { off = f; });
    return () => off?.();
  }, [loc.pathname, nav]);
  return null;
}

function Gate() {
  const { ready, profile, bootError } = useApp();
  const loc = useLocation();
  if (!ready) return <div className="splash"><img src="./logo.svg" alt="Monster Gains" /></div>;
  if (bootError) return <div className="screen no-nav col"><h1>Something went wrong</h1><Banner tone="err" icon="warn">The local database could not be opened: {bootError}</Banner><p className="dim small">Your data has not been deleted. Close the app fully and reopen it. If this persists, reinstall the same version over the top (do not uninstall) or restore from a backup.</p><Button variant="primary" onClick={() => window.location.reload()}>Try again</Button></div>;
  const onboarding = !profile?.onboarding_done;
  if (onboarding && !/^\/(onboarding|auth)/.test(loc.pathname)) return <Navigate to="/onboarding" replace />;
  return <Shell />;
}

export function App() {
  useEffect(() => { preloadScreens(); }, []);
  return (
    <HashRouter>
      <UiProvider>
        <AppProvider>
          <AppLock>
          <BackHandler />
          <Routes>
            <Route element={<Gate />}>
              <Route index element={<Today />} />
              <Route path="workout/:id" element={<Workout />} />
              <Route path="workout/:id/summary" element={<WorkoutSummary />} />
              <Route path="program" element={<Programs />} />
              <Route path="program/:id" element={<ProgramDetail />} />
              <Route path="program/:id/day/:templateKey" element={<DayEditor />} />
              <Route path="exercises" element={<Exercises />} />
              <Route path="exercises/new" element={<ExerciseForm />} />
              <Route path="exercises/:id" element={<ExerciseDetail />} />
              <Route path="exercises/:id/edit" element={<ExerciseForm />} />
              <Route path="history" element={<History />} />
              <Route path="history/compare/:a/:b" element={<Compare />} />
              <Route path="history/:id" element={<SessionDetail />} />
              <Route path="progress" element={<Progress />} />
              <Route path="progress/suggestions" element={<Suggestions />} />
              <Route path="progress/reports" element={<Reports />} />
              <Route path="progress/drill/:type/:id" element={<Drill />} />
              <Route path="more" element={<More />} />
              <Route path="recovery" element={<Recovery />} />
              <Route path="body" element={<Body />} />
              <Route path="goals" element={<Goals />} />
              <Route path="settings" element={<Settings />} />
              <Route path="backup" element={<Backup />} />
              <Route path="sync" element={<SyncStatus />} />
              <Route path="search" element={<Search />} />
              <Route path="auth" element={<Auth />} />
              <Route path="auth/recover" element={<RecoverPassword />} />
              <Route path="onboarding" element={<Onboarding />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </AppLock>
        </AppProvider>
      </UiProvider>
    </HashRouter>
  );
}
