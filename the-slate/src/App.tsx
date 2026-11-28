import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './features/auth/AuthProvider';
import { Login, SetPassword } from './features/auth/Login';
import { Shell } from './features/shell/Shell';
import { ToastProvider } from './ui/Toast';
import { ConfirmProvider } from './ui/Confirm';
import { Loading } from './ui/kit';
import { isConfigured } from './lib/env';

const Dashboard = lazy(() => import('./features/dashboard/Dashboard'));
const MandatesPage = lazy(() => import('./features/mandates/MandatesPage'));
const MandateDetail = lazy(() => import('./features/mandates/MandateDetail'));
const TalentPage = lazy(() => import('./features/talent/TalentPage'));
const CandidateProfile = lazy(() => import('./features/talent/CandidateProfile'));
const SlatePage = lazy(() => import('./features/slate/SlatePage'));
const SopPage = lazy(() => import('./features/sop/SopPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 } } });

function Gate() {
  const { user, loading, recovery } = useAuth();
  if (loading) return <Loading text="Opening THE SLATE…" />;
  if (!user) return <Login />;
  if (recovery) return <SetPassword />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="mandates" element={<MandatesPage />} />
          <Route path="mandates/:id" element={<MandateDetail />} />
          <Route path="talent" element={<TalentPage />} />
          <Route path="talent/:id" element={<CandidateProfile />} />
          <Route path="slate" element={<SlatePage />} />
          <Route path="sop" element={<SopPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  if (!isConfigured) return <div className="login"><div className="box"><div className="banner bad"><div><b>Not configured.</b> Set <span className="mono">VITE_SUPABASE_URL</span> and <span className="mono">VITE_SUPABASE_PUBLISHABLE_KEY</span> (see .env.example) and rebuild.</div></div></div></div>;
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider><ConfirmProvider><AuthProvider><BrowserRouter><Gate /></BrowserRouter></AuthProvider></ConfirmProvider></ToastProvider>
    </QueryClientProvider>
  );
}
