// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * Governance screen — bylaws, members, GA date and a plain-language proposal
 * in; a bylaw check, draft motion, GA agenda, notice email and agent log out.
 */

import React, { useState } from 'react';
import type { RocketRideClient } from 'shell';
import type { Check, Drafts, Input, LogEntry, Status } from './agents';
import { runCompliance, runGovernance } from './orchestrator';
import { SAMPLE_BYLAWS } from './sampleBylaws';
import { AgentLog, CopyButton, type LogStep, Progress, SANS, base } from './ui';

// =============================================================================
// STYLES
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
	link: { background: 'none', border: 0, color: 'var(--co-accent)', font: 'inherit', fontSize: 13, cursor: 'pointer', padding: 0, textDecoration: 'underline', marginLeft: 6 },
	quick: { marginTop: 8, fontSize: 13, color: 'var(--co-muted)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
	chip: { font: `500 12px ${SANS}`, background: '#fff', border: '1px solid var(--co-line)', borderRadius: 999, padding: '4px 10px', cursor: 'pointer', color: 'var(--co-ink)' },
	bylaws: { minHeight: 150 },
	file: { marginTop: 8, fontSize: 13 },
	summary: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
	PASS: base.good,
	FAIL: base.bad,
	UNCLEAR: base.warn,
	check: { borderTop: '1px solid var(--co-line)', padding: '12px 0', display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: 12 },
	checkFirst: { borderTop: 0 },
	quote: { margin: '6px 0 0', padding: '6px 10px', borderLeft: '3px solid var(--co-line)', color: 'var(--co-muted)', fontSize: 13 },
	sec: { fontSize: 12, color: 'var(--co-muted)' },
	h3: { margin: '0 0 8px', fontSize: 16 },
	para: { margin: '4px 0' },
	ol: { margin: 0, paddingLeft: 20 },
	grid2: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 18 },
	grid2Narrow: { gridTemplateColumns: 'minmax(0, 1fr)' },
	before: { background: 'var(--co-unc-bg)', border: '1px solid #f1dca6', borderRadius: 14, padding: 20 },
	beforeNote: { margin: '-6px 0 10px', fontSize: 13, color: 'var(--co-unc)' },
	beforeItem: { display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: 12, padding: '8px 0', borderTop: '1px solid #f1dca6' },
	removed: { marginTop: 10, fontSize: 12, color: 'var(--co-muted)' },
	formFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10 },
	reset: { background: 'none', border: 0, padding: 0, color: 'var(--co-accent)', font: 'inherit', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', flex: 'none' },
};

// =============================================================================
// HELPERS
// =============================================================================

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => isoDate(new Date(Date.now() + n * 86400000));

const STEPS = [
	{ label: 'Bylaws & Compliance agent', doing: 'reading the bylaws and checking each rule' },
	{ label: 'Governance agent', doing: 'drafting the motion, GA agenda and notice email' },
	{ label: 'Orchestrator', doing: 'handing everything to a human for review' },
];

interface Result extends Drafts {
	checks: Check[];
	log: LogStep[];
	removed: string[];
}

/** Agent log entries -> log steps: Compliance and Governance are AI, the rest is plain code. */
const toStep = (l: LogEntry): LogStep => (l.mode === 'code' ? { ...l, kind: 'code', mode: undefined } : { ...l, kind: 'ai', mode: l.mode });

const SAMPLE = { proposal: 'We want to raise the house food budget by 10%', members: '40', houseName: '' };

const motionText = (r: Result) => {
	const m = r.motion;
	return [
		m.title,
		'',
		...m.whereas.map((w) => `Whereas ${w.replace(/[;.]\s*$/, '')};`),
		...m.resolved.map((w) => `Be it resolved ${w.replace(/[;.]\s*$/, '')}.`),
		'',
		`Proposed by: ${m.proposer} · Seconded by: ${m.seconder}`,
		`Vote required: ${m.voteRequired}`,
	].join('\n');
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

const Pill: React.FC<{ status: Status; children?: React.ReactNode }> = ({ status, children }) => (
	<span style={{ ...base.pill, ...styles[status] }}>{children ?? status}</span>
);

const Results: React.FC<{ r: Result; narrow: boolean }> = ({ r, narrow }) => {
	const counts: Record<Status, number> = { PASS: 0, FAIL: 0, UNCLEAR: 0 };
	r.checks.forEach((c) => (counts[c.status] += 1));
	const m = r.motion;
	const usedFallback = r.log.some((l) => l.kind === 'ai' && l.mode === 'demo');
	const attention = r.checks.filter((c) => c.status !== 'PASS');
	return (
		<div style={base.results}>
			{usedFallback && <div style={base.banner}>Live AI was unavailable for at least one agent, so the rule based demo agent was used instead. See the agent log.</div>}

			{attention.length > 0 && (
				<div style={styles.before}>
					<h2 style={base.h2}>
						Before you send
						<CopyButton text={() => attention.map((c) => `[${c.status}] ${c.rule}: ${c.explanation}${c.section ? ` (${c.section})` : ''}`).join('\n')} />
					</h2>
					<p style={styles.beforeNote}>For the organizer only: resolve or accept these before sending anything. They are not in the member email.</p>
					{attention.map((c, i) => (
						<div key={i} style={{ ...styles.beforeItem, ...(i === 0 ? { borderTop: 0 } : {}) }}>
							<div><Pill status={c.status} /></div>
							<div>
								<span style={base.k}>{c.rule}</span>
								{c.section && <span style={styles.sec}> · {c.section}</span>}
								<div>{c.explanation}</div>
							</div>
						</div>
					))}
					{r.removed.length > 0 && <div style={styles.removed}>Also moved out of the member email: {r.removed.length} internal note(s) from the Governance agent.</div>}
				</div>
			)}

			<div style={base.card}>
				<h2 style={base.h2}>
					Bylaw check
					<CopyButton text={() => r.checks.map((c) => `[${c.status}] ${c.rule}: ${c.explanation}${c.quote ? `\n  "${c.quote}" (${c.section})` : ''}`).join('\n')} />
				</h2>
				<div style={styles.summary}>
					{(['FAIL', 'UNCLEAR', 'PASS'] as Status[]).map((s) => (
						<Pill key={s} status={s}>{`${counts[s]} ${s}`}</Pill>
					))}
				</div>
				{r.checks.map((c, i) => (
					<div key={i} style={{ ...styles.check, ...(i === 0 ? styles.checkFirst : {}) }}>
						<div><Pill status={c.status} /></div>
						<div>
							<div style={base.k}>{c.rule}</div>
							<div>{c.explanation}</div>
							{c.quote && (
								<blockquote style={styles.quote}>
									“{c.quote}”<div style={styles.sec}>{c.section}</div>
								</blockquote>
							)}
						</div>
					</div>
				))}
			</div>

			<div style={base.card}>
				<h2 style={base.h2}>Draft motion <CopyButton text={() => motionText(r)} /></h2>
				<h3 style={styles.h3}>{m.title}</h3>
				{m.whereas.map((w, i) => (
					<p key={`w${i}`} style={styles.para}><span style={base.k}>Whereas</span> {w.replace(/[;.]\s*$/, '')};</p>
				))}
				{m.resolved.map((w, i) => (
					<p key={`r${i}`} style={styles.para}><span style={base.k}>Be it resolved</span> {w.replace(/[;.]\s*$/, '')}.</p>
				))}
				<p style={styles.para}><span style={base.k}>Proposed by:</span> {m.proposer} · <span style={base.k}>Seconded by:</span> {m.seconder}</p>
				<p style={styles.para}><span style={base.k}>Vote required:</span> {m.voteRequired}</p>
			</div>

			<div style={{ ...styles.grid2, ...(narrow ? styles.grid2Narrow : {}) }}>
				<div style={base.card}>
					<h2 style={base.h2}>GA agenda <CopyButton text={() => r.agenda.map((a, i) => `${i + 1}. ${a}`).join('\n')} /></h2>
					<ol style={styles.ol}>{r.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol>
				</div>
				<div style={base.card}>
					<h2 style={base.h2}>Notice email <CopyButton text={() => `Subject: ${r.email.subject}\n\n${r.email.body}`} /></h2>
					<pre style={base.pre}><b>Subject:</b> {r.email.subject}{'\n\n'}{r.email.body}</pre>
				</div>
			</div>

			<AgentLog steps={r.log} />
		</div>
	);
};

// =============================================================================
// MAIN
// =============================================================================

export const Governance: React.FC<{ client: RocketRideClient | null; narrow: boolean; narrowResults: boolean }> = ({ client, narrow, narrowResults }) => {
	const [proposal, setProposal] = useState(SAMPLE.proposal);
	const [members, setMembers] = useState(SAMPLE.members);
	const [gaDate, setGaDate] = useState(inDays(10));
	const [houseName, setHouseName] = useState(SAMPLE.houseName);
	const [bylaws, setBylaws] = useState(SAMPLE_BYLAWS);
	const [reading, setReading] = useState(false);

	const [step, setStep] = useState<number | null>(null);
	const [notes, setNotes] = useState<string[]>([]);
	const [result, setResult] = useState<Result | null>(null);
	const busy = step !== null;

	const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const f = e.target.files?.[0];
		if (!f) return;
		setReading(true);
		try {
			setBylaws(await f.text());
		} finally {
			setReading(false);
		}
	};

	const resetDemo = () => {
		setProposal(SAMPLE.proposal);
		setMembers(SAMPLE.members);
		setGaDate(inDays(10));
		setHouseName(SAMPLE.houseName);
		setBylaws(SAMPLE_BYLAWS);
		setResult(null);
	};

	const missing = !bylaws.trim() ? 'Paste or upload your bylaws to start.' : !proposal.trim() ? 'Write your proposal to start.' : !gaDate ? 'Pick the GA date to start.' : '';

	const run = async () => {
		const input: Input = { proposal, memberCount: Number(members) || 0, gaDate, houseName, bylaws, today: isoDate(new Date()) };
		setResult(null);
		setNotes([]);
		setStep(0);
		try {
			const c = await runCompliance(client, input);
			const n0 = `${c.result.filter((x) => x.status === 'FAIL').length} FAIL found${c.log.mode === 'demo' ? ' (demo agent)' : ''}`;
			setNotes([n0]);
			setStep(1);
			const g = await runGovernance(client, input, c.result);
			setNotes([n0, `motion, agenda and email drafted${g.log.mode === 'demo' ? ' (demo agent)' : ''}`]);
			setStep(2);
			await new Promise((r) => setTimeout(r, 400));
			setResult({
				checks: c.result,
				...g.result,
				removed: g.removed,
				log: [c.log, c.quoteLog, g.log, g.cleanLog, { agent: 'Orchestrator', action: 'Handed results to a human for review', ms: 0, mode: 'code', summary: 'Nothing is sent automatically. A human decides.' } as LogEntry].map(toStep),
			});
		} finally {
			setStep(null);
		}
	};

	return (
		<main style={{ ...base.main, ...(narrow ? base.mainNarrow : {}) }}>
			<section style={base.card}>
				<label htmlFor='co-proposal' style={{ ...base.label, ...base.labelFirst }}>Your proposal, in plain language</label>
				<textarea id='co-proposal' rows={3} style={base.field} value={proposal} onChange={(e) => setProposal(e.target.value)} />

				<div style={base.row}>
					<div>
						<label htmlFor='co-members' style={base.label}>Voting members</label>
						<input id='co-members' type='number' min={1} style={base.field} value={members} onChange={(e) => setMembers(e.target.value)} />
					</div>
					<div>
						<label htmlFor='co-ga' style={base.label}>Next GA date</label>
						<input id='co-ga' type='date' style={base.field} value={gaDate} onChange={(e) => setGaDate(e.target.value)} />
					</div>
				</div>
				<div style={styles.quick}>
					Quick dates:
					<button type='button' style={styles.chip} onClick={() => setGaDate(inDays(10))}>GA in 10 days</button>
					<button type='button' style={styles.chip} onClick={() => setGaDate(inDays(5))}>GA in 5 days</button>
				</div>

				<label htmlFor='co-house' style={base.label}>House name (optional)</label>
				<input id='co-house' style={base.field} placeholder='e.g. Casa Zimbabwe' value={houseName} onChange={(e) => setHouseName(e.target.value)} />

				<label htmlFor='co-bylaws' style={base.label}>
					Bylaws
					<button type='button' style={styles.link} onClick={() => setBylaws(SAMPLE_BYLAWS)}>load sample bylaws</button>
				</label>
				<textarea id='co-bylaws' style={{ ...base.field, ...base.mono, ...styles.bylaws }} placeholder='Paste your bylaws here' value={bylaws} onChange={(e) => setBylaws(e.target.value)} />
				<input type='file' accept='.txt,text/plain' style={styles.file} onChange={onFile} disabled={reading} />
				{reading && <div style={base.hint}>Reading the file…</div>}

				<button type='button' style={{ ...base.primary, ...(busy || missing ? base.primaryBusy : {}), ...(missing && !busy ? { cursor: 'not-allowed' } : {}) }} disabled={busy || reading || !!missing} onClick={run}>
					{busy ? 'Agents working…' : 'Check and draft'}
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
					<Progress steps={STEPS} current={step as number} notes={notes} />
				) : result ? (
					<Results r={result} narrow={narrowResults} />
				) : (
					<div style={{ ...base.card, ...base.empty }}>
						Fill in the form and click <b>Check and draft</b>.<br />The AI drafts and checks. Humans decide.
					</div>
				)}
			</section>
		</main>
	);
};
