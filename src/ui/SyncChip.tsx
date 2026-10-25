import { useNavigate } from 'react-router-dom';
import { useApp } from '@/app/AppContext';
import { Icon } from './icons';

/** Always-visible sync status: what is waiting, whether we are offline, and whether anything needs attention. */
export function SyncChip() {
  const nav = useNavigate();
  const { sync, online, auth } = useApp();
  let label = 'Synced';
  let icon: 'cloud' | 'cloudoff' | 'refresh' | 'warn' = 'cloud';
  let tone = 'ok';
  if (sync.status === 'disabled' || auth.status === 'unconfigured') { label = 'Local only'; icon = 'cloudoff'; tone = 'dim'; }
  else if (auth.status !== 'signed_in') { label = 'Not backed up'; icon = 'cloudoff'; tone = 'warn'; }
  else if (!online) { label = sync.pending ? `${sync.pending} waiting` : 'Offline'; icon = 'cloudoff'; tone = 'warn'; }
  else if (sync.status === 'syncing') { label = 'Syncing…'; icon = 'refresh'; tone = ''; }
  else if (sync.status === 'error' || sync.failures > 0) { label = sync.failures ? `${sync.failures} held back` : 'Will retry'; icon = 'warn'; tone = 'bad'; }
  else if (sync.pending > 0) { label = `${sync.pending} pending`; icon = 'refresh'; tone = ''; }
  return (
    <button type="button" className={`badge ${tone}`} style={{ minHeight: 34, cursor: 'pointer' }} onClick={() => nav('/sync')} aria-label={`Sync status: ${label}`}>
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}
