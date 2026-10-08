// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * Shared CoopOS look and small building blocks used by every screen:
 * the brand palette, base styles, the Copy button, the agent progress card,
 * the agent log and the narrow-layout hook.
 */

import React, { useEffect, useState } from 'react';

// =============================================================================
// STYLES
// =============================================================================

// CoopOS brand palette (warm off-white, dark green accent), scoped to this app.
export const palette: React.CSSProperties = {
	['--co-bg' as string]: '#f6f3ec',
	['--co-panel' as string]: '#fffdf8',
	['--co-ink' as string]: '#1f2420',
	['--co-muted' as string]: '#6b6f68',
	['--co-line' as string]: '#e3ded2',
	['--co-accent' as string]: '#2f5d50',
	['--co-pass' as string]: '#2e7d4f',
	['--co-pass-bg' as string]: '#e3f2e8',
	['--co-fail' as string]: '#b3261e',
	['--co-fail-bg' as string]: '#fbe5e3',
	['--co-unc' as string]: '#9a6700',
	['--co-unc-bg' as string]: '#fdf1d6',
};

export const SERIF = "Fraunces, Georgia, 'Times New Roman', serif";
export const SANS = "Inter, var(--rr-font-family, system-ui), sans-serif";

// The only rule a style object cannot express: the pulsing progress dot.
export const KEYFRAMES = '@keyframes coopos-pulse { 50% { opacity: .3; } }';

/** Base shapes shared by both screens; each screen extends them in its own `styles`. */
export const base: Record<string, React.CSSProperties> = {
	main: { display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)', gap: 24, padding: '24px 32px', alignItems: 'start' },
	mainNarrow: { gridTemplateColumns: 'minmax(0, 1fr)', padding: 16 },
	card: { background: 'var(--co-panel)', border: '1px solid var(--co-line)', borderRadius: 14, padding: 20, minWidth: 0 },
	label: { display: 'block', fontWeight: 600, fontSize: 13, margin: '14px 0 6px' },
	labelFirst: { marginTop: 0 },
	labelHint: { fontWeight: 400, color: 'var(--co-muted)' },
	field: { width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '10px 12px', border: '1px solid var(--co-line)', borderRadius: 10, background: '#fff', color: 'var(--co-ink)' },
	mono: { fontSize: 13, fontFamily: 'ui-monospace, monospace', resize: 'vertical' },
	row: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 },
	primary: { marginTop: 18, width: '100%', background: 'var(--co-accent)', color: '#fff', border: 0, borderRadius: 10, padding: 12, font: `600 15px ${SANS}`, cursor: 'pointer' },
	primaryBusy: { opacity: 0.6, cursor: 'wait' },
	hint: { marginTop: 10, fontSize: 12, color: 'var(--co-muted)' },
	empty: { color: 'var(--co-muted)', textAlign: 'center', padding: '60px 20px' },
	results: { display: 'grid', gap: 18, minWidth: 0 },
	h2: { fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: '0 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
	pill: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap', display: 'inline-block' },
	good: { color: 'var(--co-pass)', background: 'var(--co-pass-bg)' },
	bad: { color: 'var(--co-fail)', background: 'var(--co-fail-bg)' },
	warn: { color: 'var(--co-unc)', background: 'var(--co-unc-bg)' },
	modePill: { background: '#eee', color: '#555' },
	k: { fontWeight: 600 },
	pre: { whiteSpace: 'pre-wrap', font: `14px/1.5 ${SANS}`, background: '#fff', border: '1px solid var(--co-line)', borderRadius: 10, padding: 12, margin: 0, overflowWrap: 'anywhere' },
	log: { padding: 0, margin: 0, listStyle: 'none' },
	logItem: { marginBottom: 8 },
	meta: { fontSize: 12, color: 'var(--co-muted)' },
	banner: { background: 'var(--co-unc-bg)', color: 'var(--co-unc)', borderRadius: 10, padding: '10px 14px', fontSize: 13 },
};

const styles: Record<string, React.CSSProperties> = {
	copy: { font: `12px ${SANS}`, background: '#fff', border: '1px solid var(--co-line)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', color: 'var(--co-ink)', flex: 'none' },
	steps: { display: 'grid', gap: 12 },
	step: { display: 'flex', gap: 12, alignItems: 'center', fontWeight: 500 },
	stepWaiting: { color: 'var(--co-muted)' },
	dot: { width: 12, height: 12, borderRadius: '50%', background: 'var(--co-line)', flex: 'none' },
	dotActive: { background: 'var(--co-accent)', animation: 'coopos-pulse 1s infinite' },
	dotDone: { background: 'var(--co-pass)' },
	small: { color: 'var(--co-muted)', fontWeight: 400, fontSize: 13 },
	logRow: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid var(--co-line)' },
	logRowFirst: { borderTop: 0 },
	kind: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, letterSpacing: '.03em', whiteSpace: 'nowrap' },
	kindAi: { color: '#5b3d9a', background: '#efe8fb' },
	kindCode: { color: '#555', background: '#eee' },
	ms: { fontSize: 12, color: 'var(--co-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
	logFoot: { fontSize: 12, color: 'var(--co-muted)', marginTop: 6 },
};

// =============================================================================
// HELPERS
// =============================================================================

export async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// Clipboard API can be blocked inside the shell frame; fall back to a hidden textarea.
		const ta = document.createElement('textarea');
		ta.value = text;
		document.body.appendChild(ta);
		ta.select();
		document.execCommand('copy');
		ta.remove();
	}
}

/** Tracks an element's width so the layout collapses to one column when narrow. */
export function useNarrow(ref: React.RefObject<HTMLElement>, breakpoint: number) {
	const [narrow, setNarrow] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < breakpoint));
		ro.observe(el);
		return () => ro.disconnect();
	}, [ref, breakpoint]);
	return narrow;
}

// =============================================================================
// COMPONENTS
// =============================================================================

export const CopyButton: React.FC<{ text: () => string }> = ({ text }) => {
	const [done, setDone] = useState(false);
	return (
		<button
			type='button'
			style={styles.copy}
			onClick={async () => {
				await copyText(text());
				setDone(true);
				setTimeout(() => setDone(false), 1500);
			}}
		>
			{done ? 'Copied' : 'Copy'}
		</button>
	);
};

/** Live progress of the agent team: steps before `current` are done, `current` pulses. */
export const Progress: React.FC<{ steps: { label: string; doing: string }[]; current: number; notes?: string[] }> = ({ steps, current, notes = [] }) => (
	<div style={base.card}>
		<h2 style={base.h2}>Your AI team is working</h2>
		<div style={styles.steps}>
			{steps.map((st, i) => {
				const state = i < current ? 'done' : i === current ? 'active' : 'waiting';
				const txt = state === 'done' ? notes[i] || 'done' : state === 'active' ? `${st.doing}…` : 'waiting';
				return (
					<div key={st.label} style={{ ...styles.step, ...(state === 'waiting' ? styles.stepWaiting : {}) }}>
						<span style={{ ...styles.dot, ...(state === 'active' ? styles.dotActive : state === 'done' ? styles.dotDone : {}) }} />
						<span>
							{st.label} <small style={styles.small}>· {txt}</small>
						</span>
					</div>
				);
			})}
		</div>
	</div>
);

export interface LogStep {
	agent: string;
	action: string;
	summary: string;
	ms: number;
	/** 'ai' steps call Claude through a pipeline; 'code' steps are plain code. */
	kind: 'ai' | 'code';
	/** For AI steps: whether the live pipeline answered or the demo agent stood in. */
	mode?: 'live' | 'demo';
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/** The agent log card: each step, what it did, how long it took, AI or plain code. */
export const AgentLog: React.FC<{ steps: LogStep[]; footer?: string }> = ({ steps, footer }) => {
	const ai = steps.filter((s) => s.kind === 'ai');
	const label = !ai.length ? 'Plain code only' : ai.every((s) => s.mode === 'live') ? 'Live AI' : ai.some((s) => s.mode === 'live') ? 'Live AI + demo' : 'Demo agents';
	const total = steps.reduce((a, s) => a + s.ms, 0);
	return (
		<div style={base.card}>
			<h2 style={base.h2}>
				Agent log <span style={{ ...base.pill, ...base.modePill }}>{label}</span>
			</h2>
			{steps.map((s, i) => (
				<div key={i} style={{ ...styles.logRow, ...(i === 0 ? styles.logRowFirst : {}) }}>
					<span style={{ ...styles.kind, ...(s.kind === 'ai' ? styles.kindAi : styles.kindCode) }}>
						{s.kind === 'ai' ? (s.mode === 'demo' ? 'AI · demo' : 'AI') : 'CODE'}
					</span>
					<div>
						<span style={base.k}>{s.agent}</span>: {s.action}
						<div style={base.meta}>{s.summary}</div>
					</div>
					<span style={styles.ms}>{fmtMs(s.ms)}</span>
				</div>
			))}
			<div style={styles.logFoot}>
				{steps.length} steps · {fmtMs(total)} total{footer ? ` · ${footer}` : ''}
			</div>
		</div>
	);
};
