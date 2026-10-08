// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * CoopOS agents — ported from the prototype (co-opp-hackaton, app/agents.js).
 *
 * Live mode runs two RocketRide pipelines (pipelines/compliance.pipe and
 * pipelines/governance.pipe: Webhook → Claude → Return Answers). The rule
 * based demo agents below are the fallback, so the app never breaks in front
 * of an audience. Every quote the live model returns is verified against the
 * bylaws text; unverifiable quotes are downgraded to UNCLEAR.
 */

// =============================================================================
// TYPES
// =============================================================================

export type Status = 'PASS' | 'FAIL' | 'UNCLEAR';

export interface Check {
	rule: string;
	status: Status;
	section: string | null;
	quote: string | null;
	explanation: string;
}

export interface Motion {
	title: string;
	whereas: string[];
	resolved: string[];
	proposer: string;
	seconder: string;
	voteRequired: string;
}

export interface Drafts {
	motion: Motion;
	agenda: string[];
	email: { subject: string; body: string };
}

export interface Input {
	bylaws: string;
	memberCount: number;
	gaDate: string;
	proposal: string;
	houseName: string;
	today: string;
}

export interface LogEntry {
	agent: string;
	action: string;
	ms: number;
	mode: 'live' | 'demo' | 'code';
	summary: string;
}

// =============================================================================
// HELPERS
// =============================================================================

interface Section {
	id: string;
	text: string;
}

function parseBylaws(text: string): Section[] {
	// Split into sections such as "Section 2.2. ..." or "Article 4. Shifts. ..."
	const clean = text.replace(/\r/g, '');
	const parts = clean.split(/(?=\b(?:Section\s+\d+(?:\.\d+)*\.|Article\s+\d+\.))/g);
	return parts
		.map((p) => p.trim())
		.filter((p) => /^(Section|Article)\s+\d/.test(p))
		.map((p) => {
			const id = (p.match(/^(Section\s+\d+(?:\.\d+)*|Article\s+\d+)/) as RegExpMatchArray)[1];
			return { id, text: p.replace(/\s+/g, ' ') };
		});
}

const findSection = (sections: Section[], regex: RegExp) => sections.find((s) => regex.test(s.text));

const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

function addDays(date: string, n: number): string {
	const d = new Date(date);
	d.setDate(d.getDate() + n);
	return d.toISOString().slice(0, 10);
}

const fmt = (date: string) =>
	new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, thirty: 30 };
const num = (s: string): number | undefined => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()]);

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// =============================================================================
// DEMO AGENTS (rule based, no AI)
// =============================================================================

export function demoCompliance({ bylaws, memberCount, gaDate, proposal, today }: Input): Check[] {
	const sections = parseBylaws(bylaws);
	const checks: Check[] = [];

	// 1. Who can propose
	const s1 = findSection(sections, /propose/i);
	if (s1) {
		const needsSeconder = /second/i.test(s1.text);
		checks.push({
			rule: 'Who can propose',
			status: needsSeconder ? 'UNCLEAR' : 'PASS',
			section: s1.id,
			quote: s1.text,
			explanation: needsSeconder
				? "Any member can propose, but a seconder is required. Fill in the seconder's name before sending."
				: 'Any member can propose this motion.',
		});
	} else {
		checks.push({ rule: 'Who can propose', status: 'UNCLEAR', section: null, quote: null, explanation: 'No rule about who can propose was found in the bylaws.' });
	}

	// 2. Notice period
	const s2 = findSection(sections, /notice/i);
	const daysLeft = daysBetween(today, gaDate);
	if (s2) {
		const m = s2.text.match(/at least (\w+) days/i);
		const n = m ? num(m[1]) : undefined;
		if (n != null) {
			const deadline = addDays(gaDate, -n);
			const ok = daysLeft >= n;
			checks.push({
				rule: 'Notice period',
				status: ok ? 'PASS' : 'FAIL',
				section: s2.id,
				quote: s2.text,
				explanation: ok
					? `Notice must go out ${n} days before the GA. Send it by ${fmt(deadline)} (${daysLeft} days left until the GA).`
					: `Notice needed ${n} days before the GA, but only ${daysLeft} days are left. The deadline was ${fmt(deadline)}. Move the motion to a later GA.`,
			});
		} else {
			checks.push({ rule: 'Notice period', status: 'UNCLEAR', section: s2.id, quote: s2.text, explanation: 'A notice rule exists but the number of days could not be read.' });
		}
	} else {
		checks.push({ rule: 'Notice period', status: 'UNCLEAR', section: null, quote: null, explanation: 'No notice rule found in the bylaws.' });
	}

	// 3. Quorum
	const s3 = findSection(sections, /quorum/i);
	if (s3) {
		const m = s3.text.match(/(\d+)\s*(?:percent|%)/i);
		const plusOne = /plus one/i.test(s3.text);
		const needed = m ? Math.floor((memberCount * Number(m[1])) / 100) + (plusOne ? 1 : 0) : null;
		checks.push({
			rule: 'Quorum',
			status: 'UNCLEAR',
			section: s3.id,
			quote: s3.text,
			explanation: needed
				? `Can only be confirmed at the GA: at least ${needed} of ${memberCount} members must be present.`
				: 'Quorum rule found but could not be computed.',
		});
	} else {
		checks.push({ rule: 'Quorum', status: 'UNCLEAR', section: null, quote: null, explanation: 'No quorum rule found.' });
	}

	// 4. Vote threshold (+ committee review for budget changes)
	const pct = (proposal.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i) || [])[1];
	const isBudget = /budget/i.test(proposal);
	const isBylawChange = /bylaw/i.test(proposal);
	const sBudget = findSection(sections, /budget by more than/i);
	const sOrdinary = findSection(sections, /simple majority/i);
	const sBylaw = findSection(sections, /changes to these bylaws/i);

	if (isBylawChange && sBylaw) {
		checks.push({ rule: 'Vote threshold', status: 'PASS', section: sBylaw.id, quote: sBylaw.text, explanation: 'This changes the bylaws: it needs a two thirds majority of ALL voting members, not just those present.' });
	} else if (isBudget && sBudget) {
		const limit = num((sBudget.text.match(/more than (\w+) percent/i) || [])[1] || '');
		if (pct && limit != null && Number(pct) > limit) {
			checks.push({ rule: 'Vote threshold', status: 'PASS', section: sBudget.id, quote: sBudget.text, explanation: `The change (${pct}%) is above ${limit}%: it needs a two thirds majority, not a simple majority.` });
			const r = sBudget.text.match(/at least (\w+) days before/i);
			const d = r ? num(r[1]) : undefined;
			if (d != null) {
				const deadline = addDays(gaDate, -d);
				const ok = daysLeft >= d;
				checks.push({
					rule: 'Finance Committee review',
					status: ok ? 'UNCLEAR' : 'FAIL',
					section: sBudget.id,
					quote: sBudget.text,
					explanation: ok
						? `The Finance Committee must review it by ${fmt(deadline)}. Not confirmed yet: get the review scheduled.`
						: `The review had to happen by ${fmt(deadline)}, which is too late for this GA.`,
				});
			}
		} else if (pct && limit != null) {
			checks.push({ rule: 'Vote threshold', status: 'PASS', section: sOrdinary ? sOrdinary.id : sBudget.id, quote: sOrdinary ? sOrdinary.text : sBudget.text, explanation: `The change (${pct}%) is not above ${limit}%: a simple majority of members present is enough.` });
		} else {
			checks.push({ rule: 'Vote threshold', status: 'UNCLEAR', section: sBudget.id, quote: sBudget.text, explanation: 'Budget change detected but no percentage given: the required majority depends on its size.' });
		}
	} else if (sOrdinary) {
		checks.push({ rule: 'Vote threshold', status: 'PASS', section: sOrdinary.id, quote: sOrdinary.text, explanation: 'Ordinary motion: simple majority of members present.' });
	} else {
		checks.push({ rule: 'Vote threshold', status: 'UNCLEAR', section: null, quote: null, explanation: 'No voting rule found.' });
	}

	return checks;
}

export function demoGovernance({ proposal, gaDate, houseName }: Input, checks: Check[]): Drafts {
	const house = houseName || 'the House';
	const p = proposal.trim().replace(/\.$/, '');
	const core = p.replace(/^(we|i)\s+(want|would like|propose)\s+(to\s+)?/i, '');
	const title = core.charAt(0).toUpperCase() + core.slice(1);
	const threshold = checks.find((c) => c.rule === 'Vote threshold');
	const finance = checks.find((c) => c.rule === 'Finance Committee review');

	const motion: Motion = {
		title: `Motion: ${title}`,
		whereas: [
			`members of ${house} have raised the need to ${core}`,
			'the General Assembly is the highest decision making body of the co-op',
			finance ? 'this change requires review by the Finance Committee before the vote' : 'this proposal falls within the powers of the General Assembly',
		],
		resolved: [
			`that ${house} ${core.replace(/^raise/i, 'raises').replace(/^increase/i, 'increases').replace(/^create/i, 'creates').replace(/^change/i, 'changes')}, effective after approval by the General Assembly`,
			'that the relevant managers implement this decision and report back at the next General Assembly',
		],
		proposer: '[Proposer name]',
		seconder: '[Seconder name]',
		voteRequired: threshold ? threshold.explanation : 'See bylaw check.',
	};

	const agenda = [
		'Call to order and check of quorum',
		'Approval of the previous minutes',
		'Manager reports',
		finance ? 'Finance Committee report on the proposed motion' : null,
		`Motion: ${title}`,
		'Open forum',
		'Adjournment',
	].filter((a): a is string => !!a);

	const email = {
		subject: `GA on ${fmt(gaDate)}: agenda and motion "${title}"`,
		body:
			`Hi everyone,\n\n` +
			`Our next General Assembly is on ${fmt(gaDate)}.\n\n` +
			`Agenda:\n${agenda.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\n` +
			`A motion will be presented: "${title}".\n` +
			`${threshold ? threshold.explanation : ''}\n\n` +
			`We need everyone there: quorum matters, so please come or let us know if you can't.\n\n` +
			`See you at the GA,\n[Your name]`,
	};

	return { motion, agenda, email };
}

// =============================================================================
// LIVE AGENT PROMPTS + GUARDRAILS
// =============================================================================

/** User message for compliance.pipe (the system prompt lives in the pipeline). */
export const complianceMessage = (i: Input) =>
	`Today: ${i.today}\nGA date: ${i.gaDate}\nVoting members: ${i.memberCount}\nProposal: ${i.proposal}\n\nBYLAWS:\n${i.bylaws}`;

/** User message for governance.pipe. The last paragraph keeps the member email clean (the system prompt is unchanged). */
export const governanceMessage = (i: Input, checks: Check[]) =>
	`GA date: ${i.gaDate}\nVoting members: ${i.memberCount}\nProposal: ${i.proposal}\n\nBylaw check results:\n${JSON.stringify(checks, null, 2)}\n\n` +
	'The notice email goes to all members: write it as a clean announcement (GA date, agenda, the motion, the vote required). ' +
	'Do not put bylaw-check statuses, compliance warnings, deadlines or action items for organizers, or notes about AI drafting in the email; the organizer sees those separately. No emojis.';

/** Pull the JSON object out of a model answer (which may arrive fenced, or already parsed). */
export function extractJson(answer: unknown): Record<string, unknown> {
	if (answer && typeof answer === 'object') return answer as Record<string, unknown>;
	const m = String(answer ?? '').match(/\{[\s\S]*\}/);
	if (!m) throw new Error('Model did not return JSON');
	return JSON.parse(m[0]);
}

const STATUSES: Status[] = ['PASS', 'FAIL', 'UNCLEAR'];

/** Shape check on the compliance answer so a malformed answer falls back cleanly. */
export function normalizeChecks(raw: unknown): Check[] {
	const list = (raw as { checks?: unknown }).checks;
	if (!Array.isArray(list) || list.length === 0) throw new Error('No checks in model answer');
	return list.map((c: Partial<Check>) => ({
		rule: String(c.rule ?? 'Rule'),
		status: STATUSES.includes(c.status as Status) ? (c.status as Status) : 'UNCLEAR',
		section: c.section ?? null,
		quote: c.quote ?? null,
		explanation: String(c.explanation ?? ''),
	}));
}

/** Guardrail (plain code): every quote must exist in the bylaws, otherwise the check is downgraded to UNCLEAR. */
export function verifyQuotes(checks: Check[], bylaws: string): { checks: Check[]; quoted: number; downgraded: number } {
	const hay = normalize(bylaws);
	let quoted = 0, downgraded = 0;
	const out = checks.map((check) => {
		if (!check.quote) return check;
		quoted++;
		if (hay.includes(normalize(check.quote))) return check;
		downgraded++;
		return { ...check, status: 'UNCLEAR' as Status, explanation: `[Quote could not be verified in the bylaws, downgraded to UNCLEAR] ${check.explanation}` };
	});
	return { checks: out, quoted, downgraded };
}

// Emoji and pictographs (the member email is plain text).
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
// Paragraphs that are notes for the organizer, not for members.
const INTERNAL = /disclaimer|drafted by|governance agent|compliance agent|\bAI\b|for review by|bylaw check|\bUNCLEAR\b|\bFAIL(ED)?\b|action required|must be (reviewed|completed|confirmed) by|cannot validly|will be deferred/i;

/** Safety net: keeps the member email free of internal warnings and emojis. Returns the removed paragraphs too. */
export function cleanEmail(email: { subject: string; body: string }): { email: { subject: string; body: string }; removed: string[] } {
	const removed: string[] = [];
	const paras = email.body
		.replace(new RegExp(`(?:${EMOJI.source})+ ?`, 'gu'), '')
		.replace(/(governance|compliance) agent\s*\/\s*/gi, '') // "[Governance Agent / Co-op Secretary]" -> "[Co-op Secretary]"
		.split(/\n{2,}/);
	const kept = paras.filter((p) => {
		const bad = INTERNAL.test(p) && !/^\s*(\d+\.|agenda)/im.test(p); // never drop the agenda list itself
		if (bad) removed.push(p.trim());
		return !bad;
	});
	const body = kept
		.join('\n\n')
		.replace(/^[ \t]*-{3,}[ \t]*$/gm, '') // leftover separators
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return { email: { subject: email.subject.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim(), body }, removed };
}

/** Shape check on the governance answer so a malformed draft falls back cleanly. */
export function validateDrafts(raw: Record<string, unknown>): Drafts {
	const d = raw as unknown as Drafts;
	const m = d.motion;
	if (!m || typeof m.title !== 'string' || !Array.isArray(m.whereas) || !Array.isArray(m.resolved)) throw new Error('Malformed motion');
	if (!Array.isArray(d.agenda) || !d.email || typeof d.email.subject !== 'string' || typeof d.email.body !== 'string') throw new Error('Malformed agenda or email');
	return {
		motion: { ...m, proposer: m.proposer || '[Proposer name]', seconder: m.seconder || '[Seconder name]', voteRequired: m.voteRequired || 'See bylaw check.' },
		agenda: d.agenda.map(String),
		email: d.email,
	};
}
