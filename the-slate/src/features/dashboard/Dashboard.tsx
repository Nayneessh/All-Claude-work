import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../../ui/kit';
import { CandidatesTab } from './CandidatesTab';
import { MandatesTab } from './MandatesTab';

/** Master dashboard: two tabs switch content in place (no page navigation). */
export default function Dashboard() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'candidates' ? 'candidates' : 'mandates';
  return (
    <div className="stack">
      <div className="row wrap"><h1>Dashboard</h1><span className="muted">Everything below is calculated live from your records</span></div>
      <Tabs value={tab} onChange={(v) => setSp(v === 'mandates' ? {} : { tab: v }, { replace: true })} tabs={[{ value: 'mandates', label: 'Mandates' }, { value: 'candidates', label: 'Candidates' }]} />
      {tab === 'mandates' ? <MandatesTab /> : <CandidatesTab />}
    </div>
  );
}
