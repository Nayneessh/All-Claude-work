import type { SessionStatus } from '@/domain/types';
import { Badge } from './kit';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  planned: 'Planned', in_progress: 'In progress', completed_as_planned: 'Completed', completed_modified: 'Completed · modified', partial: 'Partial', skipped: 'Skipped', cancelled: 'Cancelled', rescheduled: 'Rescheduled',
};
const TONE: Record<SessionStatus, 'ok' | 'warn' | 'bad' | 'info' | 'dim' | undefined> = {
  planned: 'dim', in_progress: undefined, completed_as_planned: 'ok', completed_modified: 'ok', partial: 'warn', skipped: 'bad', cancelled: 'dim', rescheduled: 'info',
};
export const StatusBadge = ({ status }: { status: SessionStatus }) => <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
