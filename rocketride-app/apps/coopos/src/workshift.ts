// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * Workshift module — ported from the prototype (co-opp-hackaton, app/workshift.js).
 * Principle: the AI understands messy human input, plain code does the math.
 *
 *   1. Availability agent (live: pipelines/availability.pipe, demo fallback):
 *      free text notes -> structured availability
 *   2. Scheduler (plain code, deterministic): assigns shifts fairly,
 *      respecting availability, preferences and the hour target
 *   3. Workshift agent (live: pipelines/workshift-messages.pipe, demo fallback):
 *      drafts the weekly announcement and kind reminders
 *
 * This file has no platform imports, so scripts/check-workshift.ts can run it
 * in Node against the live pipelines.
 */

// =============================================================================
// TYPES
// =============================================================================

export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type Category = 'kitchen' | 'cleaning' | 'outdoor' | 'errands' | 'other';

export interface Shift {
	id: string;
	name: string;
	day: Day;
	hours: number;
	category: Category;
}

export interface RawMember {
	name: string;
	notes: string;
	lastWeekDone: number | null;
}

export interface Person extends RawMember {
	unavailableDays: Day[];
	prefers: string[];
	avoids: string[];
}

export interface Assignment extends Shift {
	member: string;
	why: string;
}

export interface Unfilled extends Shift {
	reason: string;
}

export interface MemberLoad {
	name: string;
	hours: number;
	target: number;
	status: 'ok' | 'under';
	lastWeekDone: number | null;
	behindLastWeek: boolean;
	unavailableDays: Day[];
	prefers: string[];
}

export interface Plan {
	assignments: Assignment[];
	unfilled: Unfilled[];
	members: MemberLoad[];
	totalNeeded: number;
	totalOffered: number;
}

export interface Messages {
	announcement: { subject: string; body: string };
	reminders: { to: string; body: string }[];
}

export interface WorkshiftLog {
	agent: string;
	action: string;
	ms: number;
	mode: 'live' | 'demo' | 'code';
	summary: string;
}

export interface WorkshiftInput {
	members: string;
	shifts: string;
	targetHours: number;
	houseName: string;
	weekOf: string;
}

export interface WorkshiftResult extends Plan, Messages {
	people: Person[];
	log: WorkshiftLog[];
}

/** Runs one live pipeline with a user message and returns its parsed JSON answer. */
export type AskPipeline = (pipeline: 'availability' | 'messages', message: string) => Promise<Record<string, unknown>>;

// =============================================================================
// FORM MODEL (from the prototype's workshift.html)
// The screen edits member cards and shift rows; they are serialized to the
// same "Name: notes | done X" and "Task | Day | Hours" text the agents read.
// =============================================================================

export const CATS = ['kitchen', 'cleaning', 'outdoor', 'errands'] as const;
export type Cat = (typeof CATS)[number];

export interface MemberRow {
	name: string;
	off: Day[];
	prefers: Cat[];
	avoids: Cat[];
	done: string; // hours done last week, '' when unknown
	note: string; // free note for the AI
}

export interface ShiftRow {
	task: string;
	day: Day;
	hours: string;
}

const m = (name: string, off: Day[], prefers: Cat[], avoids: Cat[], done: number, note: string): MemberRow => ({ name, off, prefers, avoids, done: String(done), note });
export const SAMPLE_MEMBER_ROWS: MemberRow[] = [
	m('Maya', ['Thu'], ['kitchen'], [], 4, ''),
	m('Leo', ['Mon', 'Tue'], [], [], 2, 'hates bathrooms'),
	m('Priya', [], ['cleaning'], [], 4, 'away this weekend'),
	m('Sam', ['Wed'], [], [], 1, ''),
	m('Noah', [], [], [], 4, 'happy to do anything'),
	m('Ava', ['Fri', 'Sat', 'Sun'], ['kitchen'], [], 3, ''),
];

const s = (task: string, day: Day, hours: number): ShiftRow => ({ task, day, hours: String(hours) });
export const SAMPLE_SHIFT_ROWS: ShiftRow[] = [
	s('Cook dinner', 'Mon', 3), s('Dishes after dinner', 'Mon', 1), s('Clean bathrooms', 'Tue', 2), s('Cook dinner', 'Wed', 3),
	s('Dishes after dinner', 'Wed', 1), s('Sweep and mop common room', 'Thu', 2), s('Trash and recycling', 'Thu', 1),
	s('Cook dinner', 'Fri', 3), s('Dishes after dinner', 'Fri', 1), s('Groceries pickup', 'Sat', 2), s('Garden and porch', 'Sat', 2), s('Deep clean kitchen', 'Sun', 3),
];

export const emptyMember = (): MemberRow => ({ name: '', off: [], prefers: [], avoids: [], done: '', note: '' });
export const emptyShift = (): ShiftRow => ({ task: '', day: 'Mon', hours: '1' });

/** Category of a task as typed, for the colour stripe on the shift row ('' when unknown). */
export function taskCategory(t: string): Cat | '' {
	t = t.toLowerCase();
	if (/kitchen|dish|cook|dinner|lunch|breakfast|food|pots/.test(t)) return 'kitchen';
	if (/clean|bathroom|sweep|mop|vacuum|trash|recycl|compost/.test(t)) return 'cleaning';
	if (/garden|yard|outdoor|outside|porch/.test(t)) return 'outdoor';
	if (/grocer|shopping|errand|pickup|delivery/.test(t)) return 'errands';
	return '';
}

export function membersText(rows: MemberRow[]): string {
	return rows
		.map((r) => {
			const name = r.name.trim();
			if (!name) return null;
			const parts: string[] = [];
			if (r.off.length) parts.push("can't do " + r.off.join(' and '));
			if (r.prefers.length) parts.push('prefers ' + r.prefers.join(' and '));
			if (r.avoids.length) parts.push('hates ' + r.avoids.join(' and '));
			const note = r.note.trim();
			if (note) parts.push(note);
			return `${name}: ${parts.join(', ')}${r.done !== '' ? ` | done ${r.done}` : ''}`;
		})
		.filter(Boolean)
		.join('\n');
}

export function shiftsText(rows: ShiftRow[]): string {
	return rows
		.map((r) => (r.task.trim() ? `${r.task.trim()} | ${r.day} | ${r.hours || 1}` : null))
		.filter(Boolean)
		.join('\n');
}

// CSV import (Excel: File > Save As > CSV). Members: name, last week hours, notes. Shifts: task, day, hours.
function parseCsv(text: string): string[][] {
	const sep = text.includes('\t') ? '\t' : text.split(';').length > text.split(',').length ? ';' : ',';
	return text
		.split(/\r?\n/)
		.map((l) => l.split(sep).map((x) => x.trim().replace(/^"|"$/g, '')))
		.filter((r) => r.some(Boolean));
}

const isHeader = (row: string[]) => /name|task|member|shift/i.test(row[0] || '');

function csvRows(text: string): string[][] {
	const rows = parseCsv(text);
	if (rows.length && isHeader(rows[0])) rows.shift();
	return rows;
}

export const csvToMembers = (text: string): MemberRow[] =>
	csvRows(text).map((c) => ({ name: c[0], off: [], prefers: [], avoids: [], done: c[1] || '', note: c.slice(2).join(', ') }));

export const csvToShifts = (text: string): ShiftRow[] =>
	csvRows(text).map((c) => ({
		task: c[0],
		day: DAYS.find((x) => (c[1] || '').toLowerCase().startsWith(x.toLowerCase())) || 'Mon',
		hours: String(Number(c[2]) || 1),
	}));

/** Next Monday (or the Monday after, when today is Monday), as YYYY-MM-DD. */
export function nextMonday(): string {
	const d = new Date();
	const add = (8 - d.getDay()) % 7 || 7;
	d.setDate(d.getDate() + add);
	return d.toISOString().slice(0, 10);
}

// =============================================================================
// PARSING (plain code)
// =============================================================================

export const DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_WORDS: Record<string, Day> = {
	mon: 'Mon', monday: 'Mon', mondays: 'Mon', tue: 'Tue', tues: 'Tue', tuesday: 'Tue', tuesdays: 'Tue',
	wed: 'Wed', wednesday: 'Wed', wednesdays: 'Wed', thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu', thursdays: 'Thu',
	fri: 'Fri', friday: 'Fri', fridays: 'Fri', sat: 'Sat', saturday: 'Sat', saturdays: 'Sat',
	sun: 'Sun', sunday: 'Sun', sundays: 'Sun',
};
const CATEGORIES: Record<Exclude<Category, 'other'>, string[]> = {
	kitchen: ['kitchen', 'dish', 'dishes', 'cook', 'cooking', 'dinner', 'lunch', 'breakfast', 'food', 'pots'],
	cleaning: ['clean', 'cleaning', 'bathroom', 'bathrooms', 'sweep', 'mop', 'vacuum', 'trash', 'recycling', 'compost'],
	outdoor: ['garden', 'yard', 'outdoor', 'outside', 'porch'],
	errands: ['groceries', 'shopping', 'errand', 'errands', 'pickup', 'delivery'],
};

function categoryOf(text: string): Category {
	const t = text.toLowerCase();
	for (const [cat, words] of Object.entries(CATEGORIES)) if (words.some((w) => t.includes(w))) return cat as Category;
	return 'other';
}

// "Dishes after dinner | Mon | 2"
export function parseShifts(text: string): Shift[] {
	return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
		const [name, day, hours] = line.split('|').map((s) => (s || '').trim());
		const d = DAY_WORDS[(day || '').toLowerCase()] || 'Mon';
		return { id: `s${i + 1}`, name, day: d, hours: Number(hours) || 1, category: categoryOf(name) };
	});
}

// "Alice: can't do Thursdays, prefers kitchen | done 2"
export function splitMembers(text: string): RawMember[] {
	return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
		const [main, done] = line.split('|');
		const idx = main.indexOf(':');
		const name = (idx >= 0 ? main.slice(0, idx) : main).trim();
		const notes = idx >= 0 ? main.slice(idx + 1).trim() : '';
		const m = (done || '').match(/(\d+(?:\.\d+)?)/);
		return { name, notes, lastWeekDone: m ? Number(m[1]) : null };
	});
}

// =============================================================================
// 1. AVAILABILITY AGENT
// =============================================================================

export function demoAvailability(members: RawMember[]): Person[] {
	return members.map((m) => {
		const t = m.notes.toLowerCase();
		const unavailable = new Set<Day>();
		// negative phrases followed by days: "can't do Thursdays", "no Mon or Tue", "busy on Friday"
		const neg = /(can'?t|cannot|can not|no|not|busy|away|unavailable|never)\b([^.;,]*)/g;
		let r: RegExpExecArray | null;
		while ((r = neg.exec(t))) {
			for (const w of r[2].split(/[^a-z]+/)) if (DAY_WORDS[w]) unavailable.add(DAY_WORDS[w]);
		}
		if (/weekends?/.test(t) && /(can'?t|no|not|busy|away)[^.;]*weekends?/.test(t)) {
			unavailable.add('Sat');
			unavailable.add('Sun');
		}
		const prefers: string[] = [];
		const pos = /(prefer|prefers|love|loves|like|likes|happy to do|good at)\b([^.;]*)/g;
		while ((r = pos.exec(t))) {
			const c = categoryOf(r[2]);
			if (c !== 'other') prefers.push(c);
		}
		const avoids: string[] = [];
		const av = /(hate|hates|avoid|allergic|not good at|no )\b([^.;]*)/g;
		while ((r = av.exec(t))) {
			const c = categoryOf(r[2]);
			if (c !== 'other') avoids.push(c);
		}
		return { name: m.name, unavailableDays: [...unavailable], prefers: [...new Set(prefers)], avoids: [...new Set(avoids)], lastWeekDone: m.lastWeekDone, notes: m.notes };
	});
}

/** User message for availability.pipe (the system prompt lives in the pipeline). */
export const availabilityMessage = (members: RawMember[]) => members.map((m) => `${m.name}: ${m.notes || '(no notes)'}`).join('\n');

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export async function liveAvailability(members: RawMember[], ask: AskPipeline): Promise<Person[]> {
	const out = await ask('availability', availabilityMessage(members));
	if (!Array.isArray(out.members)) throw new Error('No members in model answer');
	const byName = Object.fromEntries((out.members as { name?: unknown }[]).map((m) => [String(m.name ?? '').toLowerCase(), m as Record<string, unknown>]));
	return members.map((m) => {
		const p = byName[m.name.toLowerCase()] || {};
		return {
			name: m.name,
			unavailableDays: list(p.unavailableDays).filter((d): d is Day => DAYS.includes(d as Day)),
			prefers: list(p.prefers),
			avoids: list(p.avoids),
			lastWeekDone: m.lastWeekDone,
			notes: m.notes,
		};
	});
}

// =============================================================================
// 2. SCHEDULER (plain code, deterministic)
// =============================================================================

export function schedule(people: Person[], shifts: Shift[], targetHours: number): Plan {
	const load: Record<string, number> = Object.fromEntries(people.map((p) => [p.name, 0]));
	const lastCat: Record<string, Category> = {};
	const assignments: Assignment[] = [];
	const unfilled: Unfilled[] = [];
	// hardest to fill first: fewest eligible people, then longest
	const eligible = (s: Shift) => people.filter((p) => !p.unavailableDays.includes(s.day));
	const order = [...shifts].sort((a, b) => eligible(a).length - eligible(b).length || b.hours - a.hours);

	for (const s of order) {
		const cands = eligible(s)
			.filter((p) => load[p.name] + s.hours <= targetHours + 1) // allow 1h over target at most
			.map((p) => {
				let score = load[p.name] * 10; // fairness first
				if (p.prefers.includes(s.category)) score -= 6; // preference bonus
				if (p.avoids.includes(s.category)) score += 8; // avoid penalty
				if (lastCat[p.name] === s.category) score += 2; // variety
				return { p, score };
			})
			.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name));
		if (!cands.length) {
			unfilled.push({ ...s, reason: eligible(s).length ? 'everyone available already has enough hours' : `nobody is available on ${s.day}` });
			continue;
		}
		const who = cands[0].p;
		load[who.name] += s.hours;
		lastCat[who.name] = s.category;
		const why: string[] = [];
		if (who.prefers.includes(s.category)) why.push(`prefers ${s.category}`);
		if (who.avoids.includes(s.category)) why.push(`note: usually avoids ${s.category}`);
		assignments.push({ ...s, member: who.name, why: why.join(', ') });
	}

	assignments.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
	const members: MemberLoad[] = people.map((p) => ({
		name: p.name,
		hours: load[p.name],
		target: targetHours,
		status: load[p.name] >= targetHours ? 'ok' : 'under',
		lastWeekDone: p.lastWeekDone,
		behindLastWeek: p.lastWeekDone != null && p.lastWeekDone < targetHours,
		unavailableDays: p.unavailableDays,
		prefers: p.prefers,
	}));
	const totalNeeded = people.length * targetHours;
	const totalOffered = shifts.reduce((a, s) => a + s.hours, 0);
	return { assignments, unfilled, members, totalNeeded, totalOffered };
}

// =============================================================================
// 3. WORKSHIFT AGENT (announcement + reminders)
// =============================================================================

export function demoMessages({ houseName, weekOf }: WorkshiftInput, plan: Plan): Messages {
	const house = houseName || 'the house';
	const byDay = DAYS.map((d) => {
		const items = plan.assignments.filter((a) => a.day === d);
		return items.length ? `${d}: ${items.map((a) => `${a.name} (${a.member}, ${a.hours}h)`).join('; ')}` : null;
	}).filter(Boolean);
	const announcement = {
		subject: `Workshifts for the week of ${weekOf} at ${house}`,
		body:
			`Hi everyone,\n\nHere are this week's workshifts:\n\n${byDay.join('\n')}\n\n` +
			(plan.unfilled.length ? `Still open, volunteers welcome: ${plan.unfilled.map((u) => `${u.name} (${u.day})`).join(', ')}.\n\n` : '') +
			`Can't make your shift? Find a swap and tell the workshift manager before the shift starts.\n\nThanks for keeping ${house} running,\n[Workshift manager]`,
	};
	const reminders = plan.members.filter((m) => m.behindLastWeek).map((m) => ({
		to: m.name,
		body:
			`Hi ${m.name}, quick heads up: you logged ${m.lastWeekDone}h of workshift last week, below the ${m.target}h we each owe. ` +
			`This week you have ${m.hours}h assigned. If something is going on, let me know and we'll figure it out together. [Workshift manager]`,
	}));
	return { announcement, reminders };
}

/** User message for workshift-messages.pipe. */
export const messagesMessage = (input: WorkshiftInput, plan: Plan) =>
	`House: ${input.houseName || 'the house'}\nWeek of: ${input.weekOf}\nSchedule:\n${JSON.stringify(plan, null, 2)}`;

export async function liveMessages(input: WorkshiftInput, plan: Plan, ask: AskPipeline): Promise<Messages> {
	const out = (await ask('messages', messagesMessage(input, plan))) as unknown as Messages;
	const a = out.announcement;
	if (!a || typeof a.subject !== 'string' || typeof a.body !== 'string' || !Array.isArray(out.reminders)) throw new Error('Malformed announcement or reminders');
	return { announcement: a, reminders: out.reminders.map((r) => ({ to: String(r.to ?? ''), body: String(r.body ?? '') })) };
}

// =============================================================================
// ORCHESTRATOR
// =============================================================================

/**
 * Runs the three steps in order. `ask` is null when there is no live
 * connection; each AI step also falls back to its demo agent on any failure,
 * and the log records it. `onStep(i)` fires as step i starts (0, 1, 2) and
 * with 3 when everything is done.
 */
export async function runWorkshift(input: WorkshiftInput, ask: AskPipeline | null, onStep: (step: number) => void = () => {}): Promise<WorkshiftResult> {
	const log: WorkshiftLog[] = [];
	const run = async <T>(agent: string, action: string, liveFn: (a: AskPipeline) => Promise<T>, demoFn: () => T, summarize: (r: T) => string): Promise<T> => {
		const t0 = Date.now();
		let res: T | undefined;
		let fb: string | null = ask ? null : 'not connected to RocketRide';
		if (ask) {
			try {
				res = await liveFn(ask);
			} catch (e) {
				fb = String((e as Error)?.message ?? e).slice(0, 160);
			}
		}
		const mode = res !== undefined ? 'live' : 'demo';
		if (res === undefined) res = demoFn();
		log.push({ agent, action, ms: Date.now() - t0, mode, summary: summarize(res) + (fb ? ` · Live AI unavailable (${fb}), used demo agent` : '') });
		return res;
	};

	const rawMembers = splitMembers(input.members);
	const shifts = parseShifts(input.shifts);

	onStep(0);
	const people = await run(
		'Availability agent',
		"Read members' notes and extracted availability",
		(a) => liveAvailability(rawMembers, a),
		() => demoAvailability(rawMembers),
		(ps) => `${ps.length} members · ${ps.filter((p) => p.unavailableDays.length).length} with day constraints`,
	);

	onStep(1);
	const t0 = Date.now();
	const plan = schedule(people, shifts, input.targetHours);
	log.push({
		agent: 'Scheduler (code)',
		action: 'Assigned shifts fairly, respecting availability and preferences',
		ms: Date.now() - t0,
		mode: 'code',
		summary: `${plan.assignments.length}/${shifts.length} shifts filled · ${plan.members.filter((m) => m.status === 'under').length} members under ${input.targetHours}h`,
	});

	onStep(2);
	const messages = await run(
		'Workshift agent',
		'Drafted the weekly announcement and reminders',
		(a) => liveMessages(input, plan, a),
		() => demoMessages(input, plan),
		(r) => `announcement + ${r.reminders.length} reminder(s)`,
	);

	log.push({ agent: 'Orchestrator', action: 'Handed the plan to the workshift manager for review', ms: 0, mode: 'code', summary: 'Nothing is sent automatically. The manager decides.' });
	onStep(3);
	return { people, ...plan, ...messages, log };
}
