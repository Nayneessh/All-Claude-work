import { describe, it, expect } from 'vitest';
import { parseQuickTask } from './quickTask';

const TODAY = '2026-11-28'; // Saturday
describe('quick task entry', () => {
  it('the example from the brief: "by 4 PM" is a deadline with an earlier reminder', () => {
    const t = parseQuickTask('Complete the Infinx market mapping by 4 PM.', TODAY);
    expect(t).toMatchObject({ title: 'Complete the Infinx market mapping', start_date: TODAY, due_time: '16:00', reminder_time: '15:30', repeat: 'once' });
  });
  it('plain text becomes an untimed task for today with no reminder', () => {
    expect(parseQuickTask('Call the Tandon HR head', TODAY)).toMatchObject({ title: 'Call the Tandon HR head', due_time: null, reminder_time: null, start_date: TODAY, repeat: 'once' });
  });
  it('"at 3:30 pm" is a start time reminded at that time; 24-hour clock works', () => {
    expect(parseQuickTask('Review shortlist at 3:30 pm', TODAY)).toMatchObject({ title: 'Review shortlist', due_time: '15:30', reminder_time: '15:30' });
    expect(parseQuickTask('Standup 09:15', TODAY)).toMatchObject({ title: 'Standup', due_time: '09:15' });
    expect(parseQuickTask('Lunch with Rahul at 12 pm', TODAY).due_time).toBe('12:00'); expect(parseQuickTask('Wake at 12 am', TODAY).due_time).toBe('00:00');
  });
  it('dates: tomorrow, weekday, explicit', () => {
    expect(parseQuickTask('Send JD tomorrow at 10am', TODAY)).toMatchObject({ title: 'Send JD', start_date: '2026-11-29', due_time: '10:00' });
    expect(parseQuickTask('Prepare MIS on Monday', TODAY).start_date).toBe('2026-11-30');
    expect(parseQuickTask('File taxes on 5 Dec', TODAY).start_date).toBe('2026-12-05');
  });
  it('recurrence: daily, weekdays, weekly on chosen days', () => {
    expect(parseQuickTask('Pipeline review every day at 9am', TODAY)).toMatchObject({ title: 'Pipeline review', repeat: 'daily', due_time: '09:00' });
    expect(parseQuickTask('Check inbox weekdays', TODAY)).toMatchObject({ title: 'Check inbox', repeat: 'weekdays' });
    const w = parseQuickTask('Team sync every Tue and Thu', TODAY);
    expect(w).toMatchObject({ repeat: 'custom', rec_days: [2, 4], start_date: '2026-12-01' }); // first matching day on/after today
  });
  it('duration', () => {
    expect(parseQuickTask('Deep work on mapping for 2 hours', TODAY).est_minutes).toBe(120);
    expect(parseQuickTask('Quick call for 15 min', TODAY)).toMatchObject({ title: 'Quick call', est_minutes: 15 });
  });
  it('never returns an empty title', () => { expect(parseQuickTask('tomorrow', TODAY).title).toBe('tomorrow'); });
});
