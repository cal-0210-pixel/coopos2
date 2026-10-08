// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * House dashboard — drop the house's BSC workshift spreadsheet (.xlsx) and see
 * who's behind, what's unclaimed, and get the messages ready. The file is read
 * in this browser with SheetJS and never uploaded anywhere; every step here is
 * plain code, so no member data goes to an AI either.
 */

import React, { useMemo, useState } from 'react';
import * as H from './houseData';
import { AgentLog, CopyButton, type LogStep, SERIF, base } from './ui';
import { readWorkbook } from './xlsxBook';

// =============================================================================
// STYLES
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
	main: { padding: '24px 32px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 18, maxWidth: 1300 },
	mainNarrow: { padding: 16 },
	drop: { display: 'block', border: '2px dashed var(--co-line)', borderRadius: 14, padding: '36px 20px', textAlign: 'center', background: 'var(--co-panel)', cursor: 'pointer' },
	dropOver: { borderColor: 'var(--co-accent)', background: '#fff' },
	dropTitle: { fontSize: 17, fontWeight: 600 },
	dropText: { color: 'var(--co-muted)', margin: '6px 0 0' },
	privacy: { display: 'inline-block', marginTop: 6, fontSize: 12, color: 'var(--co-pass)', background: 'var(--co-pass-bg)', borderRadius: 999, padding: '3px 10px' },
	actions: { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 },
	btn: { fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: '#fff', border: '1px solid var(--co-line)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: 'var(--co-ink)' },
	bar: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--co-muted)' },
	select: { font: 'inherit', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--co-line)', background: '#fff' },
	switch: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none' },
	barRight: { marginLeft: 'auto' },
	kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 },
	kpisNarrow: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
	kpi: { background: 'var(--co-panel)', border: '1px solid var(--co-line)', borderRadius: 14, padding: '14px 16px', minWidth: 0 },
	kpiV: { fontFamily: SERIF, fontSize: 28, lineHeight: 1.1 },
	kpiSmall: { fontSize: 14 },
	kpiL: { fontSize: 12, color: 'var(--co-muted)' },
	warnV: { color: 'var(--co-unc)' },
	badV: { color: 'var(--co-fail)' },
	goodV: { color: 'var(--co-pass)' },
	grid2: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 18 },
	grid2Narrow: { gridTemplateColumns: 'minmax(0, 1fr)' },
	note: { color: 'var(--co-muted)', fontSize: 13, marginTop: -6 },
	scroll: { maxHeight: 420, overflow: 'auto' },
	table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
	th: { textAlign: 'left', padding: '8px 6px', fontSize: 12, color: 'var(--co-muted)', fontWeight: 600, verticalAlign: 'top' },
	td: { textAlign: 'left', padding: '8px 6px', borderTop: '1px solid var(--co-line)', verticalAlign: 'top' },
	day: { fontWeight: 600, fontSize: 12, color: 'var(--co-muted)', width: 44 },
	muted: { color: 'var(--co-muted)', fontSize: 13 },
	sug: { fontSize: 12, color: 'var(--co-muted)' },
	sugTop: { color: 'var(--co-accent)', fontWeight: 600 },
	spark: { display: 'inline-flex', gap: 2, alignItems: 'flex-end', height: 22 },
	sparkBar: { width: 7, background: 'var(--co-pass)', borderRadius: 2, display: 'block' },
	sparkLo: { background: 'var(--co-unc)' },
	sparkZero: { background: 'var(--co-fail)', height: 3 },
	nudgeHead: { margin: '10px 0 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	foot: { color: 'var(--co-muted)', fontSize: 13, textAlign: 'center', margin: 0 },
	away: { marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#3a6ea5', background: '#e6eef8', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' },
	error: { background: 'var(--co-fail-bg)', color: 'var(--co-fail)', borderRadius: 10, padding: '10px 14px', fontSize: 13 },
};

// =============================================================================
// HELPERS
// =============================================================================

interface Dashboard {
	T: H.Tracker;
	W: H.Week;
	A: H.Analysis;
	abs: H.Absences;
	audit: H.Audit;
	hi: H.HiHours;
	log: LogStep[];
}

/** Runs every step on the selected week, timing each one for the agent log. */
function build(book: H.Book, sheet: string): Dashboard {
	const log: LogStep[] = [];
	const step = <T,>(agent: string, action: string, fn: () => T, summary: (r: T) => string): T => {
		const t0 = performance.now();
		const r = fn();
		log.push({ agent, action, summary: summary(r), ms: performance.now() - t0, kind: 'code' });
		return r;
	};
	const { T, W } = step(
		'Spreadsheet reader',
		'Read the Hour Tracker and the selected weekly tab',
		() => ({ T: H.parseTracker(book), W: H.parseWeek(book, sheet) }),
		({ T, W }) => `${T.members.length} members, ${T.countedWeeks} tracked weeks, ${W.shifts.length} shift entries in "${W.sheetName}"`,
	);
	const abs = step('Absence reader', 'Read who is away from the occupancy tab', () => H.parseAbsences(book), (a) => a.note);
	const A = step('Analyst', 'Computed balances, fines and open shifts', () => H.analyze(T, W, abs), (A) => `${A.open.length} open shifts, ${A.behind.length} members behind, $${Math.round(A.fines)} estimated fines`);
	step('Matcher', 'Suggested takers for open shifts', () => A.open.filter((s) => s.suggest.length).length, (n) => `${n} of ${A.open.length} open shifts have a suggested taker who owes hours and is free that day; ${A.awayCount} members away or out excluded on those days`);
	const audit = step(
		'Verification auditor',
		'Checked the verifier row of every past shift in every weekly tab',
		() => H.audit(book, H.weekSheets(book)),
		(a) => `${a.checked} past shifts in ${a.weeks} weeks: ${a.unverified} unverified, ${a.selfVerified} self-verified`,
	);
	const hi = step(
		'HI hours tracker',
		'Summed verified Home Improvement hours per member',
		() => H.parseHi(book, T, H.weekSheets(book)),
		(h) => `${h.note} ${h.short.length} members under ${H.HI_REQUIRED}h, ${h.weeksLeft} weeks left`,
	);
	return { T, W, A, abs, audit, hi, log };
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

const Kpi: React.FC<{ value: React.ReactNode; label: string; tone?: 'warn' | 'bad' | 'good' }> = ({ value, label, tone }) => (
	<div style={styles.kpi}>
		<div style={{ ...styles.kpiV, ...(tone === 'warn' ? styles.warnV : tone === 'bad' ? styles.badV : tone === 'good' ? styles.goodV : {}) }}>{value}</div>
		<div style={styles.kpiL}>{label}</div>
	</div>
);

const Spark: React.FC<{ hist: H.WeekHist[] }> = ({ hist }) => (
	<span style={styles.spark}>
		{hist.map((h) => {
			const zero = h.ver === 0 && h.owed > 0;
			return (
				<i
					key={h.week}
					title={`Week ${h.week}: ${h.ver}/${h.owed}h`}
					style={{ ...styles.sparkBar, ...(zero ? styles.sparkZero : { height: Math.max(3, Math.min(22, (h.ver / Math.max(h.owed, 1)) * 18)), ...(h.owed && h.ver < h.owed ? styles.sparkLo : {}) }) }}
				/>
			);
		})}
	</span>
);

// =============================================================================
// MAIN
// =============================================================================

export const House: React.FC<{ narrow: boolean; narrowResults: boolean }> = ({ narrow, narrowResults }) => {
	const [book, setBook] = useState<H.Book | null>(null);
	const [sheet, setSheet] = useState('');
	const [anon, setAnon] = useState(true);
	const [loading, setLoading] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [over, setOver] = useState(false);

	const open = (b: H.Book) => {
		const weeks = H.weekSheets(b);
		if (!weeks.length) throw new Error('No weekly sign-up tabs (WEEK 1, WEEK 2, …) found');
		H.parseTracker(b); // fail early with a clear message if there is no Hour Tracker
		setBook(b);
		setSheet(H.currentWeek(b, weeks));
		setError(null);
	};

	const loadFile = async (file: File) => {
		setLoading(`Reading ${file.name}…`);
		setError(null);
		try {
			const [XLSX, data] = await Promise.all([import('xlsx'), file.arrayBuffer()]);
			open(readWorkbook(XLSX, data, file.name));
		} catch (e) {
			setError(`Couldn't read this spreadsheet: ${(e as Error).message}`);
		} finally {
			setLoading(null);
		}
	};

	const loadSample = () => {
		setLoading('Loading the sample house…');
		setTimeout(() => {
			try {
				open(H.sampleBook());
			} catch (e) {
				setError((e as Error).message);
			} finally {
				setLoading(null);
			}
		}, 0);
	};

	const weeks = useMemo(() => (book ? H.weekSheets(book) : []), [book]);
	const dash = useMemo(() => (book && sheet ? build(book, sheet) : null), [book, sheet]);
	const nm = useMemo(() => H.namer(anon), [anon, book]);

	const dropZone = (
		<label
			style={{ ...styles.drop, ...(over ? styles.dropOver : {}) }}
			onDragOver={(e) => {
				e.preventDefault();
				setOver(true);
			}}
			onDragEnter={(e) => {
				e.preventDefault();
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={(e) => {
				e.preventDefault();
				setOver(false);
				const f = e.dataTransfer.files[0];
				if (f) loadFile(f);
			}}
		>
			<input
				type='file'
				accept='.xlsx,.xls'
				hidden
				onChange={(e) => {
					const f = e.target.files?.[0];
					e.target.value = '';
					if (f) loadFile(f);
				}}
			/>
			<div style={styles.dropTitle}>{loading ?? (book ? 'Drop another spreadsheet to replace it' : 'Drop the house workshift spreadsheet (.xlsx)')}</div>
			<p style={styles.dropText}>
				Works with the BSC workshift template: weekly sign-up tabs, Hour Tracker, workshift rate.
				<br />
				<span style={styles.privacy}>Read in your browser. The file never leaves this computer.</span>
			</p>
			{!book && (
				<div style={styles.actions}>
					<button
						type='button'
						style={styles.btn}
						disabled={!!loading}
						onClick={(e) => {
							e.preventDefault();
							loadSample();
						}}
					>
						Or try the sample house (fictional)
					</button>
				</div>
			)}
		</label>
	);

	if (!dash || !book) {
		return (
			<main style={{ ...styles.main, ...(narrow ? styles.mainNarrow : {}) }}>
				{dropZone}
				{error && <div style={styles.error}>{error}</div>}
			</main>
		);
	}

	const { T, W, A, audit, hi, log } = dash;
	const nudges = A.behind.slice(0, 12);
	const extras: H.ReportExtras = { audit, hi };

	return (
		<main style={{ ...styles.main, ...(narrow ? styles.mainNarrow : {}) }}>
			{dropZone}
			{error && <div style={styles.error}>{error}</div>}

			<div style={{ ...base.card, ...styles.bar }}>
				<span><b>{book.fileName}</b></span>
				<span>
					Week:{' '}
					<select style={styles.select} value={sheet} onChange={(e) => setSheet(e.target.value)}>
						{weeks.map((w) => <option key={w}>{w}</option>)}
					</select>
				</span>
				<label style={styles.switch}>
					<input type='checkbox' checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Anonymize names (for demos)
				</label>
				<span style={narrow ? undefined : styles.barRight}>
					Fine rate: <b>${T.rate}</b>/h · Weekly target: <b>{A.target}</b>h
				</span>
				<button
					type='button'
					style={styles.btn}
					disabled={!!loading}
					title='Reload the fictional sample house (any loaded file is dropped from memory)'
					onClick={() => {
						setAnon(true);
						loadSample();
					}}
				>
					{loading ? 'Loading…' : 'Reset demo'}
				</button>
			</div>

			<div style={{ ...styles.kpis, ...(narrowResults ? styles.kpisNarrow : {}) }}>
				<Kpi value={A.members.length} label='members tracked' />
				<Kpi value={<>{A.open.length} <small style={styles.kpiSmall}>({A.openHours}h)</small></>} label='shifts on the market' tone={A.open.length ? 'warn' : 'good'} />
				<Kpi value={A.behind.length} label='members behind on hours' tone={A.behind.length ? 'bad' : 'good'} />
				<Kpi value={`${A.downHours.toFixed(1)}h`} label='down hours this semester' tone={A.downHours ? 'warn' : 'good'} />
				<Kpi value={`$${Math.round(A.fines).toLocaleString()}`} label='estimated fines if not made up' tone={A.fines ? 'bad' : 'good'} />
				<Kpi value={audit.unverified} label='past shifts unverified' tone={audit.unverified ? 'warn' : 'good'} />
				<Kpi value={audit.selfVerified} label='past shifts self-verified' tone={audit.selfVerified ? 'bad' : 'good'} />
			</div>

			<div style={{ ...styles.grid2, ...(narrowResults ? styles.grid2Narrow : {}) }}>
				<div style={base.card}>
					<h2 style={base.h2}>Shifts on the market <span style={{ ...base.pill, ...base.warn }}>{A.open.length} open · {A.openHours}h</span></h2>
					<p style={styles.note}>Unclaimed this week. Suggested takers: members who owe hours and are free that day (never someone away or out that day).</p>
					<div style={styles.scroll}>
						<table style={styles.table}>
							<thead>
								<tr><th style={styles.th}>Day</th><th style={styles.th}>Shift</th><th style={styles.th}>Hours</th><th style={styles.th}>Suggested takers</th></tr>
							</thead>
							<tbody>
								{A.open.length ? (
									A.open.map((s, i) => (
										<tr key={i}>
											<td style={{ ...styles.td, ...styles.day }}>{s.day}</td>
											<td style={styles.td}>{s.name}<div style={styles.muted}>{s.section}</div></td>
											<td style={styles.td}>{s.hours}h</td>
											<td style={{ ...styles.td, ...styles.sug }}>
												{s.suggest.length
													? s.suggest.map((m, j) => (
															<span key={m.name}>
																{j ? ', ' : ''}
																<span style={j ? undefined : styles.sugTop}>{nm(m.name)}</span> ({m.balance}h)
															</span>
														))
													: 'nobody behind is free'}
											</td>
										</tr>
									))
								) : (
									<tr><td style={styles.td} colSpan={4}>No open shifts this week.</td></tr>
								)}
							</tbody>
						</table>
					</div>
				</div>

				<div style={base.card}>
					<h2 style={base.h2}>Members behind on hours <span style={{ ...base.pill, ...base.bad }}>{A.behind.length} behind</span></h2>
					<p style={styles.note}>
						{T.official ? "Net balance and fines as computed by the house's own tracker (includes rollover and special shifts)." : 'Verified minus owed since the start of the semester (weeks counted by the Hour Tracker).'}
					</p>
					<div style={styles.scroll}>
						<table style={styles.table}>
							<thead>
								<tr><th style={styles.th}>Member</th><th style={styles.th}>Balance</th><th style={styles.th}>Trend</th><th style={styles.th}>This week</th><th style={styles.th}>Est. fine</th></tr>
							</thead>
							<tbody>
								{A.behind.length ? (
									A.behind.map((m) => (
										<tr key={m.name}>
											<td style={styles.td}><b>{nm(m.name)}</b>{m.away && <span style={styles.away}>{m.away}</span>}</td>
											<td style={styles.td}><span style={{ ...base.pill, ...(m.balance <= -5 ? base.bad : base.warn) }}>{m.balance}h</span></td>
											<td style={styles.td}><Spark hist={m.hist} /></td>
											<td style={styles.td}>{m.assignedThisWeek ? `${m.assignedThisWeek}h signed up` : m.awayAllWeek ? <span style={styles.muted}>away</span> : <span style={{ ...base.pill, ...base.bad }}>none</span>}</td>
											<td style={styles.td}>${Math.round(m.fine)}</td>
										</tr>
									))
								) : (
									<tr><td style={styles.td} colSpan={5}>Nobody is behind.</td></tr>
								)}
							</tbody>
						</table>
					</div>
				</div>
			</div>

			<div style={base.card}>
				<h2 style={base.h2}>
					Verification audit
					<span>
						<span style={{ ...base.pill, ...base.bad }}>{audit.selfVerified} self-verified</span>{' '}
						<span style={{ ...base.pill, ...base.warn }}>{audit.unverified} unverified</span>
					</span>
				</h2>
				<p style={styles.note}>
					Every past day of the semester ({audit.checked} assigned shifts in {audit.weeks} weekly tabs). Self-verified means the verifier is the person who did the shift: the house rules say false verification can be fined up to $44/h.
				</p>
				<div style={styles.scroll}>
					<table style={styles.table}>
						<thead>
							<tr><th style={styles.th}>Member</th><th style={styles.th}>Shift</th><th style={styles.th}>Day</th><th style={styles.th}>Issue</th></tr>
						</thead>
						<tbody>
							{audit.issues.length ? (
								audit.issues.map((i, n) => (
									<tr key={n}>
										<td style={styles.td}><b>{nm(i.member)}</b></td>
										<td style={styles.td}>{i.shift} <span style={styles.muted}>({i.hours}h)</span></td>
										<td style={styles.td}>{i.day} {H.fmtDate(i.date)} <span style={styles.muted}>· week {i.week}</span></td>
										<td style={styles.td}><span style={{ ...base.pill, ...(i.issue === 'Self-verified' ? base.bad : base.warn) }}>{i.issue}</span></td>
									</tr>
								))
							) : (
								<tr><td style={styles.td} colSpan={4}>Every past shift has a verifier, and nobody verified their own shift.</td></tr>
							)}
						</tbody>
					</table>
				</div>
			</div>

			<div style={base.card}>
				<h2 style={base.h2}>
					Home Improvement (HI) hours <span style={{ ...base.pill, ...(hi.short.length ? base.warn : base.good) }}>{hi.short.length} still owe · {hi.owedTotal}h</span>
				</h2>
				<p style={styles.note}>
					Each member owes {H.HI_REQUIRED}h of HI per semester; only verified hours count. {hi.weeksLeft} weeks left in the semester (week {hi.currentWeek} of {hi.totalWeeks}).
				</p>
				<div style={styles.scroll}>
					<table style={styles.table}>
						<thead>
							<tr><th style={styles.th}>Member</th><th style={styles.th}>Verified HI</th><th style={styles.th}>Still owes</th></tr>
						</thead>
						<tbody>
							{hi.short.length ? (
								hi.short.map((m) => (
									<tr key={m.name}>
										<td style={styles.td}><b>{nm(m.name)}</b></td>
										<td style={styles.td}>{m.verified}h</td>
										<td style={styles.td}><span style={{ ...base.pill, ...(m.owes >= H.HI_REQUIRED ? base.bad : base.warn) }}>{m.owes}h</span></td>
									</tr>
								))
							) : (
								<tr><td style={styles.td} colSpan={3}>Everyone has done their {H.HI_REQUIRED}h of HI.</td></tr>
							)}
						</tbody>
					</table>
				</div>
			</div>

			<div style={{ ...styles.grid2, ...(narrowResults ? styles.grid2Narrow : {}) }}>
				<div style={base.card}>
					<h2 style={base.h2}>Message to the house <CopyButton text={() => H.draftHouse(A)} /></h2>
					<pre style={base.pre}>{H.draftHouse(A)}</pre>
				</div>
				<div style={base.card}>
					<h2 style={base.h2}>Weekly report for the workshift manager <CopyButton text={() => H.draftManager(A, T, W, nm, extras)} /></h2>
					<pre style={base.pre}>{H.draftManager(A, T, W, nm, extras)}</pre>
				</div>
			</div>

			<div style={base.card}>
				<h2 style={base.h2}>Personal nudges <span style={{ ...base.pill, ...base.warn }}>{nudges.length} drafts</span></h2>
				<p style={styles.note}>Kind, private reminders for members behind on hours. Drafts only: the manager reviews and sends.</p>
				{nudges.length ? (
					nudges.map((m) => (
						<div key={m.name}>
							<p style={styles.nudgeHead}><span><b>To {nm(m.name)}</b>{m.away && <span style={styles.away}>{m.away}</span>}</span><CopyButton text={() => H.draftNudge(m, A, nm)} /></p>
							<pre style={base.pre}>{H.draftNudge(m, A, nm)}</pre>
						</div>
					))
				) : (
					<p>Nobody is behind.</p>
				)}
			</div>

			<AgentLog
				steps={[...log, { agent: 'Workshift agent', action: 'Drafted the house message, the manager report and private nudges', summary: `${nudges.length} nudges from templates. No AI here: member data never leaves this browser.`, ms: 0, kind: 'code' }]}
				footer='processed entirely in this browser'
			/>
			<p style={styles.foot}>CoopOS reads the house's own spreadsheet. AI drafts, the manager decides. Fines shown are estimates; the house's rules and the workshift manager are the reference.</p>
		</main>
	);
};
