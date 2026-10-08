// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * CoopOS — an AI back office for student housing co-ops.
 *
 * Three screens behind header tabs: Governance (bylaw check + GA drafts),
 * Workshifts (fair weekly plan + announcement and reminders) and House
 * dashboard (the house's workshift spreadsheet, read in the browser). All stay
 * mounted so switching tabs keeps each screen's form and results. The AI
 * drafts and checks; humans decide. Nothing is sent automatically.
 */

import React, { useRef, useState } from 'react';
import type { ShellAppProps } from 'shell';
import { AppLayout, useShellConnection } from 'shell';
import { Governance } from './Governance';
import { House } from './House';
import { Workshifts } from './Workshifts';
import { KEYFRAMES, SANS, SERIF, palette, useNarrow } from './ui';

// =============================================================================
// STYLES
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
	root: { ...palette, background: 'var(--co-bg)', color: 'var(--co-ink)', font: `15px/1.5 ${SANS}`, minHeight: '100%', height: '100%', overflow: 'auto' },
	header: { padding: '22px 32px', display: 'flex', alignItems: 'baseline', gap: 14, borderBottom: '1px solid var(--co-line)', flexWrap: 'wrap' },
	headerNarrow: { padding: 16, gap: 8 },
	h1: { fontFamily: SERIF, fontSize: 26, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' },
	tabs: { display: 'flex', gap: 4, flexWrap: 'wrap' },
	tab: { font: `600 13px ${SANS}`, color: 'var(--co-muted)', padding: '5px 12px', borderRadius: 999, border: '1px solid var(--co-line)', background: '#fff', cursor: 'pointer' },
	tabOn: { background: 'var(--co-accent)', color: '#fff', borderColor: 'var(--co-accent)' },
	tagline: { margin: 0, color: 'var(--co-muted)' },
	taglineNarrow: { flexBasis: '100%' },
	hidden: { display: 'none' },
};

// =============================================================================
// MAIN
// =============================================================================

type Tab = 'governance' | 'workshifts' | 'house';

const TABS: { id: Tab; label: string; tagline: string }[] = [
	{ id: 'governance', label: 'Governance', tagline: 'Turn an idea into a bylaw checked motion, a GA agenda and a notice email.' },
	{ id: 'workshifts', label: 'Workshifts', tagline: "Paste the house's members and shifts. Get a fair weekly plan, an announcement and reminders." },
	{ id: 'house', label: 'House dashboard', tagline: "Drop the house's workshift spreadsheet. See who's behind, what's unclaimed, and get the messages ready." },
];

const CoopOS: React.FC<ShellAppProps> = () => {
	const { client, isConnected } = useShellConnection();
	const live = client && isConnected ? client : null;
	const rootRef = useRef<HTMLDivElement>(null);
	const narrow = useNarrow(rootRef, 900);
	const narrowResults = useNarrow(rootRef, 1100);
	const [tab, setTab] = useState<Tab>('governance');
	const current = TABS.find((t) => t.id === tab) as (typeof TABS)[number];

	return (
		<div ref={rootRef} style={styles.root}>
			<style>{KEYFRAMES}</style>
			<header style={{ ...styles.header, ...(narrow ? styles.headerNarrow : {}) }}>
				<h1 style={styles.h1}>CoopOS</h1>
				<nav style={styles.tabs} role='tablist'>
					{TABS.map((t) => (
						<button key={t.id} type='button' role='tab' aria-selected={tab === t.id} style={{ ...styles.tab, ...(tab === t.id ? styles.tabOn : {}) }} onClick={() => setTab(t.id)}>
							{t.label}
						</button>
					))}
				</nav>
				<p style={{ ...styles.tagline, ...(narrow ? styles.taglineNarrow : {}) }}>{current.tagline}</p>
			</header>
			<div style={tab === 'governance' ? undefined : styles.hidden}>
				<Governance client={live} narrow={narrow} narrowResults={narrowResults} />
			</div>
			<div style={tab === 'workshifts' ? undefined : styles.hidden}>
				<Workshifts client={live} narrow={narrow} narrowResults={narrowResults} />
			</div>
			<div style={tab === 'house' ? undefined : styles.hidden}>
				<House narrow={narrow} narrowResults={narrowResults} />
			</div>
		</div>
	);
};

const App: React.FC<ShellAppProps> = (props) => (
	<AppLayout>
		<CoopOS {...props} />
	</AppLayout>
);

export default App;
