import { useNavigate } from 'react-router-dom';
import { Badge, Card, Section } from '@/ui/kit';
import { Icon, type IconName } from '@/ui/icons';
import { useApp } from '@/app/AppContext';
import { useLive } from '@/app/hooks';
import { listGoals, listRecommendations } from '@/data/repo/misc';
import { SyncChip } from '@/ui/SyncChip';

const VERSION = '1.0.0';

export function More() {
  const nav = useNavigate();
  const { profile, auth } = useApp();
  const goals = useLive(async () => (await listGoals()).filter((g) => g.status === 'active').length, []);
  const recs = useLive(async () => (await listRecommendations()).filter((r) => r.status === 'open').length, []);
  const items: { to: string; icon: IconName; title: string; sub: string; badge?: string }[] = [
    { to: '/exercises', icon: 'dumbbell', title: 'Exercise library', sub: 'Search, custom exercises, records' },
    { to: '/goals', icon: 'target', title: 'Goals', sub: 'Targets and milestones', badge: goals.data ? String(goals.data) : undefined },
    { to: '/progress/suggestions', icon: 'bolt', title: 'Suggestions', sub: 'Explainable, always your call', badge: recs.data ? String(recs.data) : undefined },
    { to: '/recovery', icon: 'moon', title: 'Recovery check-in', sub: 'Sleep, energy, soreness' },
    { to: '/body', icon: 'scale', title: 'Body & photos', sub: 'Weight, measurements, progress photos' },
    { to: '/progress/reports', icon: 'note', title: 'Reports', sub: 'Weekly, monthly and block summaries' },
    { to: '/search', icon: 'search', title: 'Search everything', sub: 'Exercises, programs, workouts, notes' },
  ];
  const items2: typeof items = [
    { to: '/backup', icon: 'download', title: 'Backup & export', sub: 'JSON backup, CSV, restore, removed workouts' },
    { to: '/sync', icon: 'cloud', title: 'Sync status', sub: 'What is backed up, what is waiting' },
    { to: '/settings', icon: 'settings', title: 'Settings', sub: 'Units, rest timer, calculations, reminders, privacy' },
  ];
  const row = (i: (typeof items)[number]): React.ReactElement => (
    <button key={i.to} className="item" type="button" onClick={() => nav(i.to)}><Icon name={i.icon} className="gold" /><div className="grow"><div className="strong">{i.title}</div><div className="small dim">{i.sub}</div></div>{i.badge && <Badge>{i.badge}</Badge>}<Icon name="right" className="chev" size={20} /></button>
  );
  return (
    <div className="screen">
      <div className="page-title"><div className="grow"><div className="eyebrow">Monster Gains</div><h1>More</h1></div><SyncChip /></div>
      <Card tone="hl"><div className="row-flex"><img src="./logo.svg" alt="" width={48} height={48} /><div className="grow"><div className="strong">{profile?.display_name || 'Athlete'}</div><div className="small dim">{auth.status === 'signed_in' ? auth.email : auth.status === 'unconfigured' ? 'Local only' : 'Not signed in — data is on this phone only'}</div></div>
        {auth.status !== 'signed_in' && auth.status !== 'unconfigured' && <button className="btn small soft" type="button" onClick={() => nav('/auth')}>Sign in</button>}</div></Card>
      <Section title="Train & track"><Card className="pad-0"><div className="list">{items.map(row)}</div></Card></Section>
      <Section title="Your data"><Card className="pad-0"><div className="list">{items2.map(row)}</div></Card></Section>
      <p className="tiny dim center mt-5">Monster Gains v{VERSION} · your data is stored on this device first</p>
    </div>
  );
}
