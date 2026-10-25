import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@/brand/theme.css';
import { App } from '@/app/App';

/**
 * Password-reset links land here as  <origin>/#access_token=…&type=recovery.
 * Hand the tokens to the recovery screen and rewrite the hash so the router can take over.
 */
function captureRecovery(): void {
  const h = window.location.hash;
  if (h.includes('type=recovery') && h.includes('access_token=')) {
    const p = new URLSearchParams(h.replace(/^#\/?/, ''));
    const at = p.get('access_token'), rt = p.get('refresh_token');
    if (at && rt) {
      void import('@/services/supabase').then(async ({ getClient }) => {
        await getClient()?.auth.setSession({ access_token: at, refresh_token: rt });
        window.location.hash = '#/auth/recover';
      });
    }
  }
}
captureRecovery();

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App /></StrictMode>);
