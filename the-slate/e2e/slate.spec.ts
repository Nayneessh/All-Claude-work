import { test, expect } from '@playwright/test';
import { dbClient, MINI_PDF, openMenu } from './helpers';

test.describe.configure({ mode: 'serial' });
const today = new Date().toISOString().slice(0, 10);
const T = `E2E-${Date.now().toString().slice(-6)}`; // unique marker so reruns never collide
const TA = 'E' + T.slice(4).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]); // letters-only variant for person names

test('shell: six menu items, logo placeholder, dashboard opens', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('YOUR LOGO HERE')).toBeVisible();
  await page.getByRole('button', { name: 'Open menu' }).click();
  for (const n of ['Dashboard', 'Mandates', 'Talent Pool', 'The Slate', 'SOP', 'Settings']) await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: n })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/dashboard-empty.png', fullPage: true });
});

test('mandate: create with every field, consultant, JD; appears as a card with clock + band', async ({ page }) => {
  await openMenu(page, 'Mandates'); await page.getByRole('button', { name: 'New mandate' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Mandate title').fill(`${T} Chief Financial Officer`);
  await page.getByLabel('Company / entity').fill(`${T} Corp`);
  await page.getByLabel('Hiring manager level').selectOption('CXO / C-suite');
  await page.getByLabel('Number of positions').fill('2');
  await page.getByLabel('Work location').fill('Mumbai');
  await page.getByLabel('Work mode').selectOption('Hybrid');
  await page.getByLabel('Reporting to').fill('CEO');
  await page.getByLabel('Span of control').fill('12');
  await page.getByLabel('Budget').fill('2 crore');
  await page.getByLabel('Urgency').selectOption('Critical');
  await page.getByLabel('Mandate received date').fill(today);
  await page.getByLabel('Work start date').fill(today);
  await page.getByLabel('Target close date').fill(new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10));
  await expect(page.getByPlaceholder('Consultant or agency name')).toHaveCount(0); // conditional field hidden until ticked
  await page.getByLabel('Assigned to an external consultant / agency').check();
  await page.getByPlaceholder('Consultant or agency name').fill(`${T} Search Partners`); await page.keyboard.press('Enter');
  await page.getByRole('checkbox', { name: /Confidential mandate|Open for advertisement/ }).check();
  await page.getByLabel(/Job description/).setInputFiles({ name: 'jd-v1.pdf', mimeType: 'application/pdf', buffer: MINI_PDF });
  await page.getByRole('button', { name: 'Confirm & create mandate' }).click();
  await expect(page).toHaveURL(/\/mandates\/[0-9a-f-]{36}/);
  await expect(page.getByText('jd-v1.pdf')).toBeVisible();
  await expect(page.getByText('30-day clock').first()).toBeVisible();
  await expect(page.getByText(`${T} Search Partners`).first()).toBeVisible();
  const db = await dbClient();
  const { data } = await db.from('v_mandate_overview').select('*').like('title', `${T}%`).single();
  expect(data).toMatchObject({ positions: 2, urgency: 'Critical', location: 'Mumbai', work_mode: 'Hybrid', reporting_to: 'CEO', span: '12', budget: '2 crore', confidential: true, started_on: today });
  expect(data!.consultants).toEqual([`${T} Search Partners`]); expect(data!.jd_file_name).toBe('jd-v1.pdf'); expect(data!.last_activity_at).toBeTruthy();
});

test('mandate: JD can be viewed, replaced (history kept) and cards show the colour band', async ({ page }) => {
  await openMenu(page, 'Mandates');
  await page.getByPlaceholder(/Search title/).fill(T);
  const card = page.getByRole('button', { name: new RegExp(`${T} Chief Financial Officer`) });
  await expect(card).toBeVisible();
  await expect(card.locator('.band')).toHaveCSS('background-color', 'rgb(123, 30, 46)'); // Critical = maroon
  await page.screenshot({ path: 'test-results/shots/mandates.png', fullPage: true });
  await card.click();
  await page.locator('input[type=file][hidden]').first().setInputFiles({ name: 'jd-v2.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK\u0003\u0004 test') });
  await page.getByRole('button', { name: 'Replace' }).last().click().catch(() => {});
  await expect(page.getByText('jd-v2.docx').first()).toBeVisible();
  await expect(page.getByText(/1 earlier version/)).toBeVisible();
  const db = await dbClient();
  const { data: mm } = await db.from('mandates').select('id').like('title', `${T}%`).single();
  const { data } = await db.from('mandate_documents').select('file_name,is_current').eq('mandate_id', mm!.id).order('created_at'); const cur = data!.filter((d) => d.is_current);
  expect(cur.map((d) => d.file_name)).toEqual(['jd-v2.docx']); expect(data).toHaveLength(2);
  // an unsupported file is refused
  await page.locator('input[type=file][hidden]').first().setInputFiles({ name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
  await expect(page.getByText(/Only PDF and Word/)).toBeVisible();
});

test('natural-language mandate: understood, flagged, edited, saved only after confirmation', async ({ page }) => {
  await openMenu(page, 'Mandates'); await page.getByRole('button', { name: 'Describe a mandate' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill(`VP Procurement for ${T} Retail, Mumbai, reporting to the CEO, budget 80 lakhs, immediate requirement, two positions, confidential mandate.`);
  await page.getByRole('button', { name: /Fill the form/ }).click();
  await expect(page.getByText(/fields? understood/)).toBeVisible();
  await expect(page.getByLabel('Mandate title')).toHaveValue('VP Procurement');
  await expect(page.getByLabel('Company / entity')).toHaveValue(`${T} Retail`);
  await expect(page.getByLabel('Number of positions')).toHaveValue('2');
  await expect(page.getByLabel('Budget')).toHaveValue('80 lakhs');
  await expect(page.getByLabel('Reporting to')).toHaveValue('CEO');
  await expect(page.getByLabel('Urgency')).toHaveValue('High');
  await expect(page.getByText(/“immediate” was read as High urgency|"immediate" was read as High/).first()).toBeVisible(); // ambiguity highlighted
  await expect(page.getByText(/Not provided:/)).toBeVisible(); // missing info highlighted, nothing invented
  const db = await dbClient();
  expect((await db.from('mandates').select('id').eq('company', `${T} Retail`)).data).toHaveLength(0); // NOT saved yet
  await page.getByLabel('Urgency').selectOption('Critical'); // user edits the inferred value
  await page.getByRole('button', { name: 'Confirm & create mandate' }).click();
  await expect(page).toHaveURL(/\/mandates\/[0-9a-f-]{36}/);
  await expect(page.getByText('VP Procurement').first()).toBeVisible();
  const { data } = await db.from('mandates').select('urgency,confidential,positions,budget').eq('company', `${T} Retail`).single();
  expect(data).toMatchObject({ urgency: 'Critical', confidential: true, positions: 2, budget: '80 lakhs' });
});

test('talent: create via form, natural language, duplicate warning, partial-text search and filters', async ({ page }) => {
  await openMenu(page, 'Talent Pool'); await page.getByRole('button', { name: 'New candidate' }).click();
  await page.getByPlaceholder('Search or choose a mandate…').click();
  await page.getByRole('dialog').getByRole('option', { name: new RegExp(`${T} Chief Financial Officer`) }).click();
  await page.getByLabel('Candidate name').fill(`${TA} Asha Kapoor`);
  await page.getByLabel('Current company').fill('Tata Projects'); await page.getByLabel('Current designation').fill('Director Finance');
  await page.getByLabel('Phone number').fill('9876543210'); await page.getByLabel('Email ID').fill(`asha.${T.toLowerCase()}@example.com`);
  await page.getByRole('dialog').getByLabel('Source').selectOption('Naukri'); await page.getByLabel('Current CTC').fill('90 lakhs'); await page.getByLabel('Expected CTC').fill('1.2 crore');
  await page.getByLabel('Additional benefits').fill('Car, ESOPs'); await page.getByLabel('Notice period').fill('60 days'); await page.getByLabel('Current location').fill('Pune');
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & add candidate' }).click();
  await expect(page.getByRole('heading', { name: `${TA} Asha Kapoor` })).toBeVisible();
  // natural language
  await openMenu(page, 'Talent Pool'); await page.getByRole('button', { name: 'Describe a candidate' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill(`${TA} Rahul Sharma, currently VP Operations at ABC Ltd, Mumbai, current CTC 65 lakhs, expecting 80 lakhs, notice period 90 days, sourced through LinkedIn.`);
  await page.getByRole('button', { name: /Fill the form/ }).click();
  await expect(page.getByLabel('Candidate name')).toHaveValue(`${TA} Rahul Sharma`);
  await expect(page.getByLabel('Current designation')).toHaveValue('VP Operations'); await expect(page.getByLabel('Current company')).toHaveValue('ABC Ltd');
  await expect(page.getByLabel('Current CTC')).toHaveValue('65 lakhs'); await expect(page.getByLabel('Expected CTC')).toHaveValue('80 lakhs');
  await expect(page.getByLabel('Notice period')).toHaveValue('90 days'); await expect(page.getByRole('dialog').getByLabel('Source')).toHaveValue('LinkedIn'); await expect(page.getByLabel('Phone number')).toHaveValue('');
  await page.getByPlaceholder('Search or choose a mandate…').click(); await page.getByRole('dialog').getByRole('option', { name: new RegExp(`${T} Chief Financial Officer`) }).click();
  await page.getByRole('button', { name: 'Confirm & add candidate' }).click();
  await expect(page.getByRole('heading', { name: `${TA} Rahul Sharma` })).toBeVisible();
  // duplicate detection
  await openMenu(page, 'Talent Pool'); await page.getByRole('button', { name: 'New candidate' }).click();
  await page.getByLabel('Candidate name').fill(`${TA} Asha K.`); await page.getByLabel('Email ID').fill(`asha.${T.toLowerCase()}@example.com`);
  await page.getByRole('button', { name: 'Confirm & add candidate' }).click();
  await expect(page.getByText(/Possible duplicate/)).toBeVisible();
  page.once('dialog', (d) => d.accept()); await page.getByRole('button', { name: 'Cancel' }).click();
  // search: partial text on name, company, designation, mandate
  await openMenu(page, 'Talent Pool');
  const search = page.getByLabel('Search candidates');
  for (const [q, name] of [[`${TA} asha`, 'Asha Kapoor'], ['tata proj', 'Asha Kapoor'], ['director fin', 'Asha Kapoor'], [`${T} vp oper`, 'Rahul Sharma'], [`${T} chief financial`, 'Rahul Sharma'], ['pune', 'Asha Kapoor']] as const) {
    await search.fill(q); await expect(page.getByRole('button', { name: new RegExp(`Open .*${name}`) }).first()).toBeVisible();
  }
  await search.fill(`${TA} zzzz`); await expect(page.getByText('No candidates match')).toBeVisible();
  await search.fill(T); await page.getByLabel('Source').selectOption('LinkedIn');
  await expect(page.getByRole('button', { name: /Rahul Sharma/ })).toBeVisible(); await expect(page.getByRole('button', { name: /Asha Kapoor/ })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/shots/talent.png', fullPage: true });
});

test('candidate lifecycle: stage change, reject needs a reason, drop is separate, history is append-only', async ({ page }) => {
  await openMenu(page, 'Talent Pool'); await page.getByLabel('Search candidates').fill(`${TA} Asha`);
  await page.getByRole('button', { name: new RegExp(`Open .*Asha Kapoor`) }).click();
  await page.getByRole('button', { name: 'Update status' }).click();
  await page.getByLabel('New status').selectOption({ label: 'Round 1' }); await page.getByLabel('Comment').fill('Strong first round');
  await page.getByRole('button', { name: 'Record change' }).click();
  await expect(page.getByText('Strong first round').first()).toBeVisible();
  // reject: reason mandatory
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record change' })).toBeDisabled();
  await page.getByLabel(/Rejection reason/).selectOption('Client rejection'); await page.getByLabel('Comment').fill('HM not convinced');
  await page.getByRole('button', { name: 'Record change' }).click();
  await expect(page.getByText(/Rejected · Client rejection/)).toBeVisible();
  // reopen then drop (a different classification)
  await page.getByRole('button', { name: 'Reopen' }).click(); await page.getByLabel('New status').selectOption({ label: 'Round 2' }); await page.getByRole('button', { name: 'Record change' }).click();
  await page.getByRole('button', { name: 'Dropped out' }).click(); await page.getByLabel(/Reason the candidate dropped/).selectOption('Accepted another offer');
  await page.getByRole('button', { name: 'Record change' }).click();
  await expect(page.getByText(/Dropped · Accepted another offer/)).toBeVisible();
  const db = await dbClient();
  const { data: ck } = await db.from('candidates').select('id').like('name', `${TA} Asha%`).single();
  const { data: h } = await db.from('candidate_status_history').select('from_stage,to_stage,reason_type,reason,comment').eq('candidate_id', ck!.id).order('changed_at');
  const mine = h!.filter((x) => ['r1', 'rejected', 'r2', 'dropped'].includes(x.to_stage));
  expect(mine.map((x) => x.to_stage)).toEqual(['r1', 'rejected', 'r2', 'dropped']);
  expect(mine[1]).toMatchObject({ from_stage: 'r1', reason_type: 'rejection', reason: 'Client rejection', comment: 'HM not convinced' });
  expect(mine[3]).toMatchObject({ from_stage: 'r2', reason_type: 'drop', reason: 'Accepted another offer' });
  // history cannot be edited or deleted by the user
  const del = await db.from('candidate_status_history').delete().neq('id', '00000000-0000-0000-0000-000000000000').select('id'); expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
  await page.screenshot({ path: 'test-results/shots/candidate.png', fullPage: true });
  // Rahul: select -> offer with joining date soon -> shows in the joining tracker
  await openMenu(page, 'Talent Pool'); await page.getByLabel('Search candidates').fill(`${TA} Rahul`);
  await page.getByRole('button', { name: /Open .*Rahul Sharma/ }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click(); await page.getByRole('button', { name: 'Record change' }).click();
  await page.getByRole('button', { name: 'Update status' }).click(); await page.getByLabel('New status').selectOption({ label: 'Offered' });
  await page.getByLabel('Expected joining date').fill(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)); await page.getByLabel('Offered CTC').fill('85 lakhs');
  await page.getByRole('button', { name: 'Record change' }).click();
  await expect(page.getByText(/Joining \d+ \w+/).first()).toBeVisible();
});

test('dashboard: live numbers on both tabs, funnel, joining tracker, drill-down', async ({ page }) => {
  await page.goto('/');
  const db = await dbClient();
  const { count: total } = await db.from('mandates').select('*', { count: 'exact', head: true });
  await expect(page.getByRole('button', { name: /Total mandates/ }).locator('.n')).toHaveText(String(total));
  await expect(page.getByText('Critical attention')).toBeVisible();
  await expect(page.getByText('Conversion funnel')).toBeVisible();
  await expect(page.locator('.funnel .f-row').first()).toBeVisible();
  await expect(page.getByText('Upcoming joining tracker')).toBeVisible();
  await expect(page.getByRole('cell', { name: `${TA} Rahul Sharma` })).toBeVisible();
  await expect(page.getByText(/This week|Joins today|Upcoming/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/dashboard-mandates.png', fullPage: true });
  const url = page.url(); await page.getByRole('tab', { name: 'Candidates' }).click();
  expect(page.url().split('?')[0]).toBe(url.split('?')[0]); // same page, no navigation
  await expect(page.getByRole('button', { name: /Total candidates/ })).toBeVisible();
  const { count: people } = await db.from('candidates').select('*', { count: 'exact', head: true });
  await expect(page.getByRole('button', { name: /Total candidates/ }).locator('.n')).toHaveText(String(people));
  await expect(page.getByText('Source-wise distribution')).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/dashboard-candidates.png', fullPage: true });
  await page.getByRole('button', { name: /Dropped out/ }).click(); await expect(page).toHaveURL(/status=dropped/);
  await expect(page.getByRole('button', { name: /Asha Kapoor/ })).toBeVisible();
});

test('The Slate: quick add, tick/strike/persist, sub-tasks with progress, reopen', async ({ page }) => {
  await openMenu(page, 'The Slate');
  await page.getByLabel('Add a task').fill(`${T} Complete the Infinx market mapping by 4 PM.`); await page.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.locator('.task').filter({ hasText: `${T} Complete the Infinx market mapping` }).first();
  await expect(row).toBeVisible(); await expect(row).toContainText('4:00 PM'); await expect(row).toContainText('3:30 PM'); // due 4 PM, reminder 30 min before
  // sub-tasks
  for (const s of ['Identify companies', 'Research key executives']) {
    await row.getByRole('button', { name: 'Add sub-task' }).click();
    await page.getByLabel('Task name').fill(`${T} ${s}`); await page.getByRole('button', { name: 'Add task' }).click();
  }
  const sub = page.locator('.sub-tasks .task').filter({ hasText: 'Identify companies' });
  if (!(await sub.isVisible())) await row.getByRole('button', { name: 'Toggle sub-tasks' }).click();
  await sub.getByRole('checkbox').check();
  await expect(row.locator('.progress')).toHaveAttribute('aria-valuenow', '50');
  await expect(sub).toHaveClass(/done/);
  const dbx = await dbClient();
  await expect.poll(async () => (await dbx.from('slate_done').select('task_id').is('undone_at', null)).data?.length, { timeout: 15000 }).toBe(1); // saved before we reload
  await page.reload();
  const row2 = page.locator('.task').filter({ hasText: `${T} Complete the Infinx market mapping` }).first();
  await row2.getByRole('button', { name: 'Toggle sub-tasks' }).click();
  await expect(page.locator('.sub-tasks .task').filter({ hasText: 'Identify companies' })).toHaveClass(/done/); // persisted
  await row2.getByRole('checkbox').first().check(); await expect(row2).toHaveClass(/done/);
  await expect.poll(async () => (await dbx.from('slate_done').select('task_id').is('undone_at', null)).data?.length, { timeout: 15000 }).toBe(2);
  await row2.getByRole('checkbox').first().uncheck(); await expect(row2).not.toHaveClass(/done/); // reopen
  await expect.poll(async () => (await dbx.from('slate_done').select('task_id').is('undone_at', null)).data?.length, { timeout: 15000 }).toBe(1);
  const { data: rows } = await dbx.from('slate_done').select('day,completed_at,undone_at'); expect(rows).toHaveLength(2); // the reopened row keeps its record (undone_at set), nothing was deleted
  await page.screenshot({ path: 'test-results/shots/slate-list.png', fullPage: true });
});

test('The Slate: detailed task with custom recurrence, reminder, follow-up, difficulty, duration', async ({ page }) => {
  await openMenu(page, 'The Slate'); await page.getByRole('button', { name: 'Detailed task' }).click();
  await page.getByLabel('Task name').fill(`${T} Pipeline review`);
  await page.getByRole('button', { name: 'Custom', exact: true }).first().click();
  await page.getByRole('button', { name: 'Mon', exact: true }).click(); await page.getByRole('button', { name: 'Thu', exact: true }).click();
  await page.getByLabel('Start time').fill('10:00'); await page.getByLabel('Reminder timing').selectOption('10');
  await page.getByRole('button', { name: /30 min later/ }).click(); await page.getByRole('button', { name: /Extra Focus/ }).click(); await page.getByRole('button', { name: '1 h', exact: true }).click();
  await page.getByRole('button', { name: 'Add task' }).click();
  const db = await dbClient();
  const { data } = await db.from('slate_tasks').select('*').eq('title', `${T} Pipeline review`).single();
  expect(data).toMatchObject({ repeat: 'custom', rec_days: [1, 4], due_time: '10:00:00', reminder_time: '09:50:00', followup_minutes: 30, difficulty: 'extra_focus', est_minutes: 60 });
});

test('calendar: drag moves a task, resizing stores the real duration and keeps the estimate', async ({ page }) => {
  await openMenu(page, 'The Slate'); await page.getByRole('tab', { name: 'Calendar view' }).click();
  const ev = page.locator('.ev').filter({ hasText: `${T} Complete the Infinx market mapping` }).first();
  await ev.scrollIntoViewIfNeeded(); await expect(ev).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/calendar-before.png', fullPage: false });
  // move 1 hour later by dragging the body
  let b = (await ev.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 12); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + 12 + 30, { steps: 4 }); await page.mouse.move(b.x + b.width / 2, b.y + 12 + 56, { steps: 6 }); await page.mouse.up();
  const db = await dbClient();
  await expect.poll(async () => (await db.from('slate_tasks').select('due_time').like('title', `${T} Complete the Infinx%`).single()).data?.due_time, { timeout: 15000 }).toBe('17:00:00');
  // stretch from 30 minutes to 2 hours by dragging the bottom edge
  const ev2 = page.locator('.ev').filter({ hasText: `${T} Complete the Infinx market mapping` }).first();
  b = (await ev2.boundingBox())!; const hx = b.x + b.width / 2, hy = b.y + b.height - 3;
  await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx, hy + 40, { steps: 5 }); await page.mouse.move(hx, hy + 84, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await db.from('slate_tasks').select('sched_minutes').like('title', `${T} Complete the Infinx%`).single()).data?.sched_minutes, { timeout: 15000 }).toBe(120);
  const { data } = await db.from('slate_tasks').select('est_minutes,sched_minutes,due_time,reminder_time').like('title', `${T} Complete the Infinx%`).single();
  expect(data).toMatchObject({ est_minutes: 30, sched_minutes: 120, due_time: '17:00:00', reminder_time: '16:30:00' }); // estimate preserved; reminder moved with the task
  await expect(page.locator('.ev').filter({ hasText: `${T} Complete the Infinx` }).first()).toContainText('est 30 min');
  await page.screenshot({ path: 'test-results/shots/calendar-after.png', fullPage: false });
  // day / month views render and the recurring task shows up
  await page.getByRole('tab', { name: 'Month' }).click(); await expect(page.locator('.month .cell').first()).toBeVisible(); await expect(page.locator('.pill-ev').filter({ hasText: `${T} Pipeline review` }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/calendar-month.png', fullPage: true });
  await page.getByRole('tab', { name: 'Day' }).click(); await expect(page.locator('.cal-col')).toHaveCount(1);
});

test('calendar: moving one occurrence of a recurring task leaves the series alone', async ({ page }) => {
  await openMenu(page, 'The Slate'); await page.getByRole('tab', { name: 'Calendar view' }).click(); await page.getByRole('tab', { name: 'Week' }).click();
  const db = await dbClient();
  const { data: t } = await db.from('slate_tasks').select('id,due_time').eq('title', `${T} Pipeline review`).single();
  const ev = page.locator('.ev').filter({ hasText: `${T} Pipeline review` }).first();
  if (await ev.count() === 0) { await page.getByRole('button', { name: 'Next' }).click(); }
  await ev.scrollIntoViewIfNeeded(); const b = (await ev.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 12); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + 40, { steps: 4 }); await page.mouse.move(b.x + b.width / 2, b.y + 12 + 112, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await db.from('slate_overrides').select('*').eq('task_id', t!.id)).data?.length, { timeout: 15000 }).toBe(1);
  expect((await db.from('slate_tasks').select('due_time').eq('id', t!.id).single()).data!.due_time).toBe('10:00:00'); // series unchanged
});

test('SOP: autosaves and survives a reload', async ({ page }) => {
  await openMenu(page, 'SOP'); const ta = page.getByLabel('SOP content');
  await ta.fill(`${T} Step 1: Intake call within 24 hours.\nStep 2: Share JD.`);
  await expect(page.getByText(/^Saved/)).toBeVisible({ timeout: 15000 });
  await page.reload(); await expect(page.getByLabel('SOP content')).toHaveValue(new RegExp(`${T} Step 1`));
  await page.getByLabel('SOP content').fill(`${T} Step 1: edited.`); await expect(page.getByText(/^Saved/)).toBeVisible({ timeout: 15000 });
  await page.reload(); await expect(page.getByLabel('SOP content')).toHaveValue(`${T} Step 1: edited.`);
});

test('settings: preferences persist, a new source is usable, push state shown, export downloads', async ({ page }) => {
  await openMenu(page, 'Settings');
  await page.getByLabel('Inactivity alert after (days)').fill('4'); await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await page.reload(); await expect(page.getByLabel('Inactivity alert after (days)')).toHaveValue('4');
  await page.getByLabel('Inactivity alert after (days)').fill('5'); await page.getByRole('button', { name: 'Save preferences' }).click(); await expect(page.getByText('Preferences saved')).toBeVisible();
  await page.getByRole('tab', { name: 'Lists & stages' }).click(); await page.getByPlaceholder(/Add a source/).fill(`${T} Headhunt`); await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('input[aria-label="Source name"]').last()).toHaveValue(`${T} Headhunt`);
  await page.getByRole('button', { name: 'Recruitment stages' }).click(); await expect(page.locator('input[aria-label="Stage name"]').first()).toHaveValue('Sourced');
  await page.getByRole('button', { name: 'Rejection reasons' }).click(); await expect(page.locator('input[aria-label="Reason name"]').first()).toHaveValue('Interview rejection');
  await page.getByRole('tab', { name: 'Notifications' }).click(); await expect(page.getByText(/devices? registered/)).toBeVisible(); await expect(page.getByText('Push reminders')).toBeVisible();
  await page.getByRole('tab', { name: 'Data & security' }).click();
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: /Download everything/ }).click(); const d = await dl; expect(d.suggestedFilename()).toMatch(/the-slate-export-.*\.json/);
  await page.screenshot({ path: 'test-results/shots/settings.png', fullPage: true });
});

test('no horizontal overflow and the menu works on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const path of ['/', '/mandates', '/talent', '/slate', '/sop', '/settings']) {
    await page.goto(path); await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(over, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  await page.goto('/mandates'); await page.screenshot({ path: 'test-results/shots/mobile-mandates.png', fullPage: false });
});
