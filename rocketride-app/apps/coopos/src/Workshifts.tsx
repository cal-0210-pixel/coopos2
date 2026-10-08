// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * Workshifts screen — members with free text notes and this week's shifts in;
 * a fair weekly plan (week grid + members table), an announcement, kind
 * reminders and the agent log out. The AI reads the notes, plain code does
 * the scheduling, the workshift manager decides.
 */

import React, { useState } from 'react';
import type { RocketRideClient } from 'shell';
import { workshiftAsk } from './orchestrator';
import { AgentLog, CopyButton, type LogStep, Progress, SANS, base } from './ui';
import {
	type Cat,
	type Category,
	CATS,
	DAYS,
	type Day,
	type MemberRow,
	SAMPLE_MEMBER_ROWS,
	SAMPLE_SHIFT_ROWS,
	type ShiftRow,
	type WorkshiftResult,
	csvToMembers,
	csvToShifts,
	emptyMember,
	emptyShift,
	membersText,
	nextMonday,
	runWorkshift,
	shiftsText,
	taskCategory,
} from './workshift';

// =============================================================================
// STYLES
// =============================================================================

const CATEGORY_COLOR: Record<Category, string> = {
	kitchen: '#c26a2e',
	cleaning: '#3a6ea5',
	outdoor: '#2e7d4f',
	errands: '#7a4fa0',
	other: 'var(--co-accent)',
};

const styles: Record<string, React.CSSProperties> = {
	stats: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 },
	week: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 },
	weekNarrow: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
	dayTitle: { margin: '0 0 6px', fontSize: 13, color: 'var(--co-muted)', textTransform: 'uppercase', letterSpacing: '.04em' },
	shift: { background: '#fff', border: '1px solid var(--co-line)', borderLeftWidth: 4, borderRadius: 8, padding: 8, marginBottom: 6, fontSize: 13, overflowWrap: 'anywhere' },
	shiftOpen: { borderLeftColor: 'var(--co-fail)', background: 'var(--co-fail-bg)' },
	shiftName: { display: 'block', fontWeight: 600 },
	who: { color: 'var(--co-accent)', fontWeight: 600 },
	why: { color: 'var(--co-muted)', fontSize: 12 },
	tableWrap: { overflowX: 'auto' },
	table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
	th: { textAlign: 'left', padding: '8px 6px', fontSize: 12, color: 'var(--co-muted)', fontWeight: 600 },
	td: { textAlign: 'left', padding: '8px 6px', borderTop: '1px solid var(--co-line)', verticalAlign: 'top' },
	tdMuted: { color: 'var(--co-muted)', fontSize: 13 },
	bar: { height: 8, background: 'var(--co-line)', borderRadius: 99, overflow: 'hidden', minWidth: 80, marginTop: 7 },
	barFill: { display: 'block', height: '100%', background: 'var(--co-pass)' },
	barUnder: { background: 'var(--co-unc)' },
	reminderHead: { margin: '0 0 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	reminder: { marginBottom: 10 },
	foot: { color: 'var(--co-muted)', fontSize: 13, textAlign: 'center', margin: 0 },

	// Form: CSV import, member cards, shift rows
	imp: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--co-muted)', marginBottom: 14, padding: 10, border: '1px dashed var(--co-line)', borderRadius: 10 },
	impbtn: { margin: 0, font: `600 12px ${SANS}`, color: 'var(--co-accent)', background: '#fff', border: '1px solid var(--co-line)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' },
	mcard: { background: '#fff', border: '1px solid var(--co-line)', borderRadius: 10, padding: 10, marginBottom: 8, display: 'grid', gap: 8 },
	mtop: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 92px 28px', gap: 6, alignItems: 'center' },
	mname: { padding: '7px 8px', fontSize: 14, fontWeight: 600, borderRadius: 8 },
	hrs: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--co-muted)' },
	hrsInput: { width: 48, padding: '7px 8px', fontSize: 14, fontWeight: 400, borderRadius: 8 },
	del: { border: 0, background: 'none', color: 'var(--co-muted)', fontSize: 18, cursor: 'pointer', borderRadius: 6, height: 32 },
	chips: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
	lbl: { fontSize: 11, color: 'var(--co-muted)', width: 56 },
	chip: { font: `500 12px ${SANS}`, border: '1px solid var(--co-line)', background: 'var(--co-panel)', color: 'var(--co-ink)', borderRadius: 999, padding: '3px 9px', cursor: 'pointer', userSelect: 'none' },
	chipOff: { background: 'var(--co-fail-bg)', color: 'var(--co-fail)', borderColor: '#f0b9b4', textDecoration: 'line-through' },
	chipPref: { background: 'var(--co-pass-bg)', color: 'var(--co-pass)', borderColor: '#b5dcc3' },
	chipAvoid: { background: 'var(--co-fail-bg)', color: 'var(--co-fail)', borderColor: '#f0b9b4' },
	mnote: { padding: '6px 8px', fontSize: 12, borderRadius: 8 },
	add: { marginTop: 2, background: 'none', border: '1px dashed var(--co-line)', borderRadius: 8, width: '100%', padding: 7, font: `500 13px ${SANS}`, color: 'var(--co-accent)', cursor: 'pointer' },
	sgrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 74px 56px 28px', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--co-muted)', fontWeight: 600, marginBottom: 4 },
	erow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 74px 56px 28px', gap: 6, alignItems: 'center', marginBottom: 6 },
	einput: { padding: '7px 8px', fontSize: 13, borderRadius: 8 },
	emptyRows: { fontSize: 13, color: 'var(--co-muted)', padding: '10px 12px', border: '1px dashed var(--co-line)', borderRadius: 8, marginBottom: 6, textAlign: 'center' },
	formFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10 },
	reset: { background: 'none', border: 0, padding: 0, color: 'var(--co-accent)', font: 'inherit', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', flex: 'none' },
	impError: { flexBasis: '100%', color: 'var(--co-fail)' },
};

// Hover states a style object cannot express (from the prototype's CSS).
const HOVER_RULES = `
.ws-del:hover { background: var(--co-fail-bg) !important; color: var(--co-fail) !important; }
.ws-add:hover { border-color: var(--co-accent) !important; background: #fff !important; }
.ws-impbtn:hover { border-color: var(--co-accent) !important; }`;

// =============================================================================
// HELPERS
// =============================================================================

const STEPS = [
	{ label: 'Availability agent', doing: "reading members' notes" },
	{ label: 'Scheduler', doing: 'assigning shifts fairly' },
	{ label: 'Workshift agent', doing: 'drafting the announcement and reminders' },
];

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

const Results: React.FC<{ r: WorkshiftResult; narrow: boolean }> = ({ r, narrow }) => {
	const under = r.members.filter((m) => m.status === 'under').length;
	const usedFallback = r.log.some((l) => l.mode === 'demo');
	const steps: LogStep[] = r.log.map((l) => (l.mode === 'code' ? { ...l, kind: 'code', mode: undefined } : { ...l, kind: 'ai', mode: l.mode }));
	return (
		<div style={base.results}>
			{usedFallback && <div style={base.banner}>Live AI was unavailable for at least one agent, so the rule based demo agent was used instead. See the agent log.</div>}

			<div style={base.card}>
				<h2 style={base.h2}>This week's plan</h2>
				<div style={styles.stats}>
					<span style={{ ...base.pill, ...(r.unfilled.length ? base.bad : base.good) }}>{r.assignments.length}/{r.assignments.length + r.unfilled.length} shifts filled</span>
					<span style={{ ...base.pill, ...(under ? base.warn : base.good) }}>{under} member{under === 1 ? '' : 's'} under target</span>
					<span style={{ ...base.pill, ...(r.totalOffered < r.totalNeeded ? base.warn : base.good) }}>{r.totalOffered}h of shifts for {r.totalNeeded}h owed</span>
				</div>
				<div style={{ ...styles.week, ...(narrow ? styles.weekNarrow : {}) }}>
					{DAYS.map((d) => (
						<div key={d}>
							<h4 style={styles.dayTitle}>{d}</h4>
							{r.assignments.filter((a) => a.day === d).map((a) => (
								<div key={a.id} style={{ ...styles.shift, borderLeftColor: CATEGORY_COLOR[a.category] }}>
									<span style={styles.shiftName}>{a.name}</span>
									<span style={styles.who}>{a.member}</span> · {a.hours}h
									{a.why && <div style={styles.why}>{a.why}</div>}
								</div>
							))}
							{r.unfilled.filter((u) => u.day === d).map((u) => (
								<div key={u.id} style={{ ...styles.shift, ...styles.shiftOpen }}>
									<span style={styles.shiftName}>{u.name}</span>Open · {u.hours}h
									<div style={styles.why}>{u.reason}</div>
								</div>
							))}
						</div>
					))}
				</div>
			</div>

			<div style={base.card}>
				<h2 style={base.h2}>Members</h2>
				<div style={styles.tableWrap}>
					<table style={styles.table}>
						<thead>
							<tr>
								<th style={styles.th}>Member</th>
								<th style={styles.th}>This week</th>
								<th style={styles.th} />
								<th style={styles.th}>Last week</th>
								<th style={styles.th}>Constraints read by the AI</th>
							</tr>
						</thead>
						<tbody>
							{r.members.map((m) => {
								const p = r.people.find((x) => x.name === m.name);
								const cons =
									[
										p?.unavailableDays.length ? `off ${p.unavailableDays.join(', ')}` : '',
										p?.prefers.length ? `prefers ${p.prefers.join(', ')}` : '',
										p?.avoids.length ? `avoids ${p.avoids.join(', ')}` : '',
									]
										.filter(Boolean)
										.join(' · ') || 'none';
								return (
									<tr key={m.name}>
										<td style={styles.td}><b>{m.name}</b></td>
										<td style={styles.td}>{m.hours}/{m.target}h</td>
										<td style={styles.td}>
											<div style={styles.bar}>
												<span style={{ ...styles.barFill, ...(m.status === 'under' ? styles.barUnder : {}), width: `${Math.min(100, (m.hours / m.target) * 100)}%` }} />
											</div>
										</td>
										<td style={styles.td}>
											{m.lastWeekDone == null ? 'n/a' : <span style={{ ...base.pill, ...(m.behindLastWeek ? base.warn : base.good) }}>{m.lastWeekDone}h</span>}
										</td>
										<td style={{ ...styles.td, ...styles.tdMuted }}>{cons}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>

			<div style={base.card}>
				<h2 style={base.h2}>Announcement <CopyButton text={() => `Subject: ${r.announcement.subject}\n\n${r.announcement.body}`} /></h2>
				<pre style={base.pre}><b>Subject:</b> {r.announcement.subject}{'\n\n'}{r.announcement.body}</pre>
			</div>

			<div style={base.card}>
				<h2 style={base.h2}>Reminders <span style={{ ...base.pill, ...base.warn }}>{r.reminders.length} to send</span></h2>
				{r.reminders.length ? (
					r.reminders.map((x, i) => (
						<div key={i} style={styles.reminder}>
							<p style={styles.reminderHead}><b>To {x.to}</b><CopyButton text={() => x.body} /></p>
							<pre style={base.pre}>{x.body}</pre>
						</div>
					))
				) : (
					<p>Everyone did their hours last week.</p>
				)}
			</div>

			<AgentLog steps={steps} />

			<p style={styles.foot}>AI reads and drafts. Code schedules. The workshift manager decides. Nothing is sent automatically.</p>
		</div>
	);
};

// =============================================================================
// FORM
// =============================================================================

type Keyed<T> = T & { id: number };
let nextId = 1;
const keyed = <T,>(row: T): Keyed<T> => ({ ...row, id: nextId++ });

/** Likes chip cycle: neutral -> likes -> avoids -> neutral. */
function cycleCat(r: MemberRow, c: Cat): Pick<MemberRow, 'prefers' | 'avoids'> {
	if (r.prefers.includes(c)) return { prefers: r.prefers.filter((x) => x !== c), avoids: [...r.avoids, c] };
	if (r.avoids.includes(c)) return { prefers: r.prefers, avoids: r.avoids.filter((x) => x !== c) };
	return { prefers: [...r.prefers, c], avoids: r.avoids };
}

const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
	if (e.key === 'Enter') fn();
};

const MemberCard: React.FC<{ row: Keyed<MemberRow>; autoFocus: boolean; onChange: (patch: Partial<MemberRow>) => void; onRemove: () => void }> = ({ row, autoFocus, onChange, onRemove }) => (
	<div style={styles.mcard}>
		<div style={styles.mtop}>
			<input placeholder='Name' aria-label='Name' autoFocus={autoFocus} style={{ ...base.field, ...styles.mname }} value={row.name} onChange={(e) => onChange({ name: e.target.value })} />
			<span style={styles.hrs} title='Hours done last week'>
				last wk <input type='number' min={0} step={0.5} aria-label='Hours done last week' style={{ ...base.field, ...styles.hrsInput }} value={row.done} onChange={(e) => onChange({ done: e.target.value })} />h
			</span>
			<button type='button' className='ws-del' aria-label='Remove' style={styles.del} onClick={onRemove}>×</button>
		</div>
		<div style={styles.chips}>
			<span style={styles.lbl}>Can't do</span>
			{DAYS.map((d) => {
				const toggle = () => onChange({ off: row.off.includes(d) ? row.off.filter((x) => x !== d) : DAYS.filter((x) => x === d || row.off.includes(x)) });
				return (
					<span key={d} role='button' tabIndex={0} style={{ ...styles.chip, ...(row.off.includes(d) ? styles.chipOff : {}) }} onClick={toggle} onKeyDown={onEnter(toggle)}>
						{d}
					</span>
				);
			})}
		</div>
		<div style={styles.chips}>
			<span style={styles.lbl}>Likes</span>
			{CATS.map((c) => {
				const state = row.prefers.includes(c) ? 'pref' : row.avoids.includes(c) ? 'avoid' : '';
				const toggle = () => onChange(cycleCat(row, c));
				return (
					<span key={c} role='button' tabIndex={0} title='Click: likes, again: avoids, again: neutral' style={{ ...styles.chip, ...(state === 'pref' ? styles.chipPref : state === 'avoid' ? styles.chipAvoid : {}) }} onClick={toggle} onKeyDown={onEnter(toggle)}>
						{state === 'pref' ? '♥ ' : state === 'avoid' ? '✕ ' : ''}
						{c}
					</span>
				);
			})}
		</div>
		<input placeholder='Anything else? e.g. away Oct 20, exams next week' aria-label='Other notes' style={{ ...base.field, ...styles.mnote }} value={row.note} onChange={(e) => onChange({ note: e.target.value })} />
	</div>
);

const ShiftRowEditor: React.FC<{ row: Keyed<ShiftRow>; autoFocus: boolean; onChange: (patch: Partial<ShiftRow>) => void; onRemove: () => void }> = ({ row, autoFocus, onChange, onRemove }) => {
	const cat = taskCategory(row.task);
	return (
		<div style={styles.erow}>
			<input placeholder='Task' aria-label='Task' autoFocus={autoFocus} style={{ ...base.field, ...styles.einput, ...(cat ? { borderLeft: `4px solid ${CATEGORY_COLOR[cat]}` } : {}) }} value={row.task} onChange={(e) => onChange({ task: e.target.value })} />
			<select aria-label='Day' style={{ ...base.field, ...styles.einput }} value={row.day} onChange={(e) => onChange({ day: e.target.value as Day })}>
				{DAYS.map((d) => <option key={d}>{d}</option>)}
			</select>
			<input type='number' min={0.5} step={0.5} aria-label='Hours' style={{ ...base.field, ...styles.einput }} value={row.hours} onChange={(e) => onChange({ hours: e.target.value })} />
			<button type='button' className='ws-del' aria-label='Remove' style={styles.del} onClick={onRemove}>×</button>
		</div>
	);
};

// =============================================================================
// MAIN
// =============================================================================

export const Workshifts: React.FC<{ client: RocketRideClient | null; narrow: boolean; narrowResults: boolean }> = ({ client, narrow, narrowResults }) => {
	const [members, setMembers] = useState<Keyed<MemberRow>[]>(() => SAMPLE_MEMBER_ROWS.map(keyed));
	const [shifts, setShifts] = useState<Keyed<ShiftRow>[]>(() => SAMPLE_SHIFT_ROWS.map(keyed));
	const [focusId, setFocusId] = useState<number | null>(null);
	const [target, setTarget] = useState('4');
	const [weekOf, setWeekOf] = useState(nextMonday());
	const [houseName, setHouseName] = useState('');

	const [step, setStep] = useState<number | null>(null);
	const [result, setResult] = useState<WorkshiftResult | null>(null);
	const [importing, setImporting] = useState<'members' | 'shifts' | null>(null);
	const [importError, setImportError] = useState<string | null>(null);
	const busy = step !== null;

	const membersInput = membersText(members);
	const shiftsInput = shiftsText(shifts);
	const missing = !membersInput ? 'Add at least one member with a name to start.' : !shiftsInput ? 'Add at least one shift to start.' : '';

	const resetDemo = () => {
		setMembers(SAMPLE_MEMBER_ROWS.map(keyed));
		setShifts(SAMPLE_SHIFT_ROWS.map(keyed));
		setTarget('4');
		setWeekOf(nextMonday());
		setHouseName('');
		setResult(null);
		setImportError(null);
	};

	const patch = <T,>(set: React.Dispatch<React.SetStateAction<Keyed<T>[]>>, id: number) => (p: Partial<T>) => set((rows) => rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
	const remove = <T,>(set: React.Dispatch<React.SetStateAction<Keyed<T>[]>>, id: number) => () => set((rows) => rows.filter((r) => r.id !== id));
	const add = <T,>(set: React.Dispatch<React.SetStateAction<Keyed<T>[]>>, row: T) => {
		const k = keyed(row);
		setFocusId(k.id);
		set((rows) => [...rows, k]);
	};

	// CSV files are read in the browser only; nothing is uploaded.
	const importCsv = (what: 'members' | 'shifts', onText: (text: string) => number) => async (e: React.ChangeEvent<HTMLInputElement>) => {
		const input = e.target;
		const f = input.files?.[0];
		if (!f) return;
		setImporting(what);
		setImportError(null);
		try {
			if (!onText(await f.text())) setImportError(`No ${what} found in ${f.name}.`);
		} catch (err) {
			setImportError(`Couldn't read ${f.name}: ${(err as Error).message}`);
		} finally {
			setImporting(null);
			input.value = '';
		}
	};

	const run = async () => {
		setResult(null);
		setStep(0);
		try {
			const r = await runWorkshift(
				{ members: membersInput, shifts: shiftsInput, targetHours: Number(target) || 4, houseName, weekOf },
				client ? workshiftAsk(client) : null,
				setStep,
			);
			await new Promise((ok) => setTimeout(ok, 300));
			setResult(r);
		} finally {
			setStep(null);
		}
	};

	return (
		<main style={{ ...base.main, ...(narrow ? base.mainNarrow : {}) }}>
			<style>{HOVER_RULES}</style>
			<section style={base.card}>
				<div style={styles.imp}>
					<span>Already have a spreadsheet?</span>
					<label className='ws-impbtn' style={styles.impbtn}>
						{importing === 'members' ? 'Importing…' : 'Import members (CSV)'}
						<input type='file' accept='.csv,.txt,.tsv' hidden disabled={!!importing} onChange={importCsv('members', (t) => { const rows = csvToMembers(t); if (rows.length) setMembers(rows.map(keyed)); return rows.length; })} />
					</label>
					<label className='ws-impbtn' style={styles.impbtn}>
						{importing === 'shifts' ? 'Importing…' : 'Import shifts (CSV)'}
						<input type='file' accept='.csv,.txt,.tsv' hidden disabled={!!importing} onChange={importCsv('shifts', (t) => { const rows = csvToShifts(t); if (rows.length) setShifts(rows.map(keyed)); return rows.length; })} />
					</label>
					{importError && <span style={styles.impError}>{importError}</span>}
				</div>

				<div style={base.label}>
					Members <span style={base.labelHint}>· click the days they can't do and what they like</span>
				</div>
				{!members.length && <div style={styles.emptyRows}>No members yet. Add one below or import a CSV.</div>}
				{members.map((r) => (
					<MemberCard key={r.id} row={r} autoFocus={r.id === focusId} onChange={patch(setMembers, r.id)} onRemove={remove(setMembers, r.id)} />
				))}
				<button type='button' className='ws-add' style={styles.add} onClick={() => add(setMembers, emptyMember())}>+ Add member</button>

				<div style={base.label}>Shifts this week</div>
				<div style={styles.sgrid}><span>Task</span><span>Day</span><span>Hours</span><span /></div>
				{!shifts.length && <div style={styles.emptyRows}>No shifts yet. Add one below or import a CSV.</div>}
				{shifts.map((r) => (
					<ShiftRowEditor key={r.id} row={r} autoFocus={r.id === focusId} onChange={patch(setShifts, r.id)} onRemove={remove(setShifts, r.id)} />
				))}
				<button type='button' className='ws-add' style={styles.add} onClick={() => add(setShifts, emptyShift())}>+ Add shift</button>

				<div style={base.row}>
					<div>
						<label htmlFor='ws-target' style={base.label}>Hours per member</label>
						<input id='ws-target' type='number' min={1} style={base.field} value={target} onChange={(e) => setTarget(e.target.value)} />
					</div>
					<div>
						<label htmlFor='ws-week' style={base.label}>Week of</label>
						<input id='ws-week' type='date' style={base.field} value={weekOf} onChange={(e) => setWeekOf(e.target.value)} />
					</div>
				</div>
				<label htmlFor='ws-house' style={base.label}>House name (optional)</label>
				<input id='ws-house' style={base.field} placeholder='e.g. Casa Zimbabwe' value={houseName} onChange={(e) => setHouseName(e.target.value)} />

				<button type='button' style={{ ...base.primary, ...(busy || missing ? base.primaryBusy : {}), ...(missing && !busy ? { cursor: 'not-allowed' } : {}) }} disabled={busy || !!importing || !!missing} onClick={run}>
					{busy ? 'Agents working…' : "Build this week's plan"}
				</button>
				<div style={styles.formFoot}>
					<span style={{ ...base.hint, marginTop: 0 }}>
						{missing || (client ? 'Live AI: Claude via RocketRide pipelines, with demo agents as fallback.' : 'Offline: the rule based demo agents will run.')}
					</span>
					<button type='button' style={styles.reset} disabled={busy} onClick={resetDemo}>Reset demo</button>
				</div>
			</section>

			<section style={{ minWidth: 0 }}>
				{busy ? (
					<Progress steps={STEPS} current={step as number} />
				) : result ? (
					<Results r={result} narrow={narrowResults} />
				) : (
					<div style={{ ...base.card, ...base.empty }}>
						Add your members and shifts, then click <b>Build this week's plan</b>.<br />The AI reads the notes, the scheduler does the math. The manager decides.
					</div>
				)}
			</section>
		</main>
	);
};
