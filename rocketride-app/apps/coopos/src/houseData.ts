// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * House dashboard logic — ported from the prototype (co-opp-hackaton,
 * app/public/house.html). Reads a BSC workshift workbook (weekly sign-up tabs
 * + Hour Tracker) and computes open shifts, members behind, suggested takers
 * and draft messages. Everything here is plain code that runs in the browser:
 * real member data never leaves it.
 *
 * The workbook arrives as a `Book` (sheet names + rows of cells), so this file
 * has no SheetJS or platform imports and can be tested in Node.
 */

// =============================================================================
// TYPES
// =============================================================================

export type Cell = string | number | boolean | Date | null | undefined;

/** A workbook as plain rows: what SheetJS `sheet_to_json({ header: 1 })` gives. */
export interface Book {
	fileName: string;
	sheetNames: string[];
	rows(sheet: string): Cell[][];
}

export interface WeekHist {
	week: number;
	owed: number;
	ver: number;
}

export interface TrackedMember {
	name: string;
	hist: WeekHist[];
	owed: number;
	ver: number;
	balance: number;
	officialFine: number | null;
	rollover: number;
}

export interface Tracker {
	rate: number;
	members: TrackedMember[];
	countedWeeks: number;
	official: boolean;
}

export interface WeekShift {
	name: string;
	section: string;
	hours: number;
	day: string; // Mon..Sun, or 'Any' for week-long shifts
	dayIdx: number; // 0..6, -1 for week-long
	who: string | null;
	open: boolean;
	verifier: string;
}

export interface Week {
	sheetName: string;
	num: number;
	dates: (Date | null)[];
	shifts: WeekShift[];
}

export interface OpenShift extends WeekShift {
	suggest: Member[];
}

export interface Member extends TrackedMember {
	assignedThisWeek: number;
	fine: number;
	/** 'away this week', 'out Tue, Thu', or '' (from the occupancy tab). */
	away: string;
	awayAllWeek: boolean;
}

export interface Analysis {
	target: number;
	members: Member[];
	behind: Member[];
	open: OpenShift[];
	openHours: number;
	noShift: Member[];
	downHours: number;
	fines: number;
	awayCount: number;
}

// =============================================================================
// HELPERS
// =============================================================================

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NOT_PEOPLE = /^(on market|ikc|n\/?a|none|tbd|closed|-+)$/i;

export const num = (v: Cell): number | null => {
	const x = parseFloat(String(v));
	return isFinite(x) ? x : null;
};

/** Name key used to match a member across tabs ("Lee, Ana" and "ana  lee" match). */
export const key = (n: string) => {
	const s = n.replace(/\s+/g, ' ').trim().toLowerCase();
	const m = s.match(/^([^,]+),\s*(.+)$/);
	return m ? `${m[2]} ${m[1]}` : s;
};

/** Calendar day (local midnight) of a cell: a Date, an Excel serial number, or null. */
export function toDate(v: Cell): Date | null {
	if (v instanceof Date && !isNaN(+v)) {
		// SheetJS dates can land a few hours off midnight depending on time zone: snap to the nearest day.
		const d = new Date(+v + 12 * 3600 * 1000);
		return new Date(d.getFullYear(), d.getMonth(), d.getDate());
	}
	if (typeof v === 'number' && v > 20000 && v < 80000) {
		const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
		return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
	}
	return null;
}

export const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const FAKE = ['Alex', 'Bea', 'Cam', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lou', 'Mae', 'Nia', 'Oli', 'Pia', 'Quin', 'Rae', 'Sol', 'Tal', 'Uma', 'Vic', 'Wes', 'Xia', 'Yan', 'Zoe', 'Ari', 'Bo', 'Cy', 'Dee', 'Edo', 'Fin', 'Gia', 'Hal', 'Ida', 'Jo', 'Kit', 'Lev', 'Mo', 'Nev', 'Ora', 'Pax', 'Rio', 'Sky', 'Teo', 'Val', 'Wyn', 'Yuri', 'Zed', 'Ana', 'Ben', 'Cleo', 'Dan', 'Ema', 'Flo', 'Gil', 'Hugo', 'Iris', 'Jay', 'Kim', 'Lia', 'Max', 'Noa', 'Oz', 'Pat', 'Ren', 'Sam', 'Tom', 'Ula', 'Vera'];

/** Name display function: identity, or stable pseudonyms (for demos) when `anonymize` is on. */
export function namer(anonymize: boolean): (n: string) => string {
	if (!anonymize) return (n) => n;
	const pseudo = new Map<string, string>();
	return (n) => {
		const k = key(n);
		if (!pseudo.has(k)) pseudo.set(k, FAKE[pseudo.size % FAKE.length] + (pseudo.size >= FAKE.length ? ' ' + Math.floor(pseudo.size / FAKE.length + 1) : ''));
		return pseudo.get(k) as string;
	};
}

// =============================================================================
// PARSING (plain code)
// =============================================================================

export function parseTracker(book: Book): Tracker {
	const name = book.sheetNames.find((n) => /hour\s*tracker/i.test(n));
	if (!name) throw new Error("No 'Hour Tracker' tab found");
	const R = book.rows(name);
	let rate = 22;
	const rowHdr = R.findIndex((r) => r && r[0] === 'Name');
	R.forEach((r) => r && r.forEach((c, j) => {
		if (typeof c === 'string' && /workshift rate/i.test(c) && num(r[j + 1])) rate = num(r[j + 1]) as number;
	}));
	const included = R.find((r) => r && r[1] === 'Included') || [];
	const H = R[rowHdr] || [];
	const weeks: { owed: number; ver: number; n: number; counted: boolean }[] = []; // pairs: [owedCol, verifiedCol]
	for (let j = 1; j + 1 < H.length; j += 2) {
		if (!/hours owed/i.test(String(H[j] || ''))) break;
		weeks.push({ owed: j, ver: j + 1, n: weeks.length + 1, counted: included[j + 1] === true || included[j + 1] === 'TRUE' });
	}
	// The template computes its own official balance: Name / Rollover / Net / Fine / Processing Fee / Subtotal
	const ci = (re: RegExp, from = 1) => H.findIndex((c, j) => j >= from && typeof c === 'string' && re.test(c.trim()));
	const nCol = ci(/^name$/i, 1), netCol = ci(/^net$/i), fineCol = ci(/^fine$/i), subCol = ci(/^subtotal$/i), rollCol = ci(/^rollover$/i);
	const official: Record<string, { net: number; fine: number; rollover: number }> = {};
	if (nCol > 0 && netCol > 0) {
		for (let i = rowHdr + 1; i < R.length; i++) {
			const r = R[i];
			if (!r || typeof r[nCol] !== 'string') continue;
			const net = num(r[netCol]);
			if (net == null) continue;
			official[key(r[nCol] as string)] = { net, fine: num(r[subCol]) ?? num(r[fineCol]) ?? 0, rollover: num(r[rollCol]) ?? 0 };
		}
	}
	const members: TrackedMember[] = [];
	for (let i = rowHdr + 3; i < R.length; i++) {
		const r = R[i];
		if (!r || !r[0] || typeof r[0] !== 'string' || /^totals?$/i.test(r[0])) continue;
		const hist = weeks.filter((w) => w.counted).map((w) => ({ week: w.n, owed: num(r[w.owed]) ?? 0, ver: num(r[w.ver]) ?? 0 }));
		const owed = hist.reduce((a, h) => a + h.owed, 0), ver = hist.reduce((a, h) => a + h.ver, 0);
		const o = official[key(r[0])];
		members.push({ name: r[0].trim(), hist, owed, ver, balance: o ? o.net : +(ver - owed).toFixed(2), officialFine: o ? o.fine : null, rollover: o ? o.rollover : 0 });
	}
	return { rate, members, countedWeeks: weeks.filter((w) => w.counted).length, official: Object.keys(official).length > 0 };
}

export function parseWeek(book: Book, sheetName: string): Week {
	const R = book.rows(sheetName);
	const di = R.findIndex((r) => r && r.slice(2, 9).filter((c) => toDate(c)).length >= 5);
	const dates = di >= 0 ? R[di].slice(2, 9).map(toDate) : [];
	const shifts: WeekShift[] = [];
	let section = '';
	for (let i = di >= 0 ? di + 1 : 1; i < R.length; i++) {
		const r = R[i];
		if (!r || !r[0]) continue;
		const label = String(r[0]).replace(/\s+/g, ' ').trim();
		if (/^-+\s*verifier/i.test(label)) continue;
		const hours = num(r[1]);
		if (hours == null) {
			section = label;
			continue;
		}
		const ver = R[i + 1] && /^-+\s*verifier/i.test(String(R[i + 1][0] || '')) ? R[i + 1] : null;
		const weekLong = /week-long|any day/i.test(section) || r.slice(3, 9).every((c) => !c);
		const cells: [number, Cell][] = weekLong ? [[0, r[2]]] : DAYS.map((_, d) => [d, r[2 + d]]);
		for (const [d, who] of cells) {
			const w = who == null ? '' : String(who).trim();
			if (!w) continue;
			const v = ver ? ver[2 + (weekLong ? 0 : d)] : null;
			shifts.push({
				name: label,
				section,
				hours,
				day: weekLong ? 'Any' : DAYS[d],
				dayIdx: weekLong ? -1 : d,
				who: /^on market$/i.test(w) ? null : w,
				open: /^on market$/i.test(w),
				verifier: v ? String(v).trim() : '',
			});
		}
	}
	return { sheetName, num: weekNum(sheetName), dates, shifts };
}

const weekNum = (sheetName: string) => parseInt((sheetName.match(/week\s+(\d+)/i) || [])[1] || '0');

export function weekSheets(book: Book): string[] {
	return book.sheetNames
		.filter((n) => /^(temp\s+)?week\s+\d+/i.test(n.trim()) && !/summer/i.test(n))
		.map((n) => ({ n, k: weekNum(n) }))
		.sort((a, b) => a.k - b.k)
		.map((x) => x.n);
}

const currentWeek_ = (book: Book, weeks: string[], today: Date) => currentWeek(book, weeks, today);

/** The weekly tab whose dates contain `today` (else the last one). */
export function currentWeek(book: Book, weeks: string[], today = new Date()): string {
	let pick = weeks[weeks.length - 1];
	for (const w of weeks) {
		const d = parseWeek(book, w).dates.filter(Boolean) as Date[];
		if (d.length && today >= d[0] && today <= new Date(+d[d.length - 1] + 86400000)) pick = w;
	}
	return pick;
}

// =============================================================================
// ABSENCES (plain code) — the "Fall Occupancy" tab
// Two layouts are understood: day columns where a member is marked out
// ("out", "away", "absent", "x"…), or week columns with hours owed, where 0
// hours owed that week means away.
// =============================================================================

export interface Absences {
	tab: string | null;
	mode: 'days' | 'weeks' | 'none';
	note: string;
	awayWeeks: Map<string, Set<number>>; // member key -> week numbers
	outDays: Map<string, Set<number>>; // member key -> day timestamps (local midnight)
}

const OUT_MARK = /\b(out|away|absent|gone|vacation|travel(?:ing)?|abroad|x)\b/i;

export function parseAbsences(book: Book): Absences {
	const none = (tab: string | null, note: string): Absences => ({ tab, mode: 'none', note, awayWeeks: new Map(), outDays: new Map() });
	const tab = book.sheetNames.find((n) => /occupancy/i.test(n)) ?? null;
	if (!tab) return none(null, 'No occupancy tab found: nobody is treated as away.');
	const R = book.rows(tab);
	const hi = R.slice(0, 15).findIndex((r) => r && r.some((c) => typeof c === 'string' && /^(name|member|resident)s?$/i.test(c.trim())));
	if (hi < 0) return none(tab, `"${tab}" has no Name column: nobody is treated as away.`);
	const H = R[hi];
	const nameCol = H.findIndex((c) => typeof c === 'string' && /^(name|member|resident)s?$/i.test(c.trim()));
	const dateCols: [number, Date][] = [];
	const weekCols: [number, number][] = [];
	H.forEach((c, j) => {
		if (j === nameCol) return;
		const d = toDate(c);
		if (d) return void dateCols.push([j, d]);
		const w = typeof c === 'string' ? c.match(/week\s*(\d+)/i) : null;
		if (w) weekCols.push([j, +w[1]]);
		else if (typeof c === 'number' && Number.isInteger(c) && c >= 1 && c <= 30) weekCols.push([j, c]);
	});
	const rows = R.slice(hi + 1).filter((r) => r && typeof r[nameCol] === 'string' && r[nameCol].trim());
	if (dateCols.length >= 3) {
		const outDays = new Map<string, Set<number>>();
		for (const r of rows) {
			const set = new Set<number>();
			for (const [j, d] of dateCols) if (typeof r[j] === 'string' && OUT_MARK.test(r[j] as string)) set.add(+d);
			if (set.size) outDays.set(key(r[nameCol] as string), set);
		}
		return { tab, mode: 'days', note: `"${tab}" read as days out (${dateCols.length} day columns, ${outDays.size} members with days out).`, awayWeeks: new Map(), outDays };
	}
	if (weekCols.length) {
		const awayWeeks = new Map<string, Set<number>>();
		for (const r of rows) {
			const set = new Set<number>();
			for (const [j, w] of weekCols) if (num(r[j]) === 0) set.add(w);
			if (set.size) awayWeeks.set(key(r[nameCol] as string), set);
		}
		return { tab, mode: 'weeks', note: `"${tab}" read as hours owed per week (${weekCols.length} weeks); 0 hours owed = away that week.`, awayWeeks, outDays: new Map() };
	}
	return none(tab, `"${tab}" has no day or week columns that could be read: nobody is treated as away.`);
}

/** Days (0..6) a member is out during week W, and whether they are away all week. */
function absenceIn(abs: Absences | undefined, name: string, W: Week): { days: Set<number>; allWeek: boolean } {
	const k = key(name);
	if (!abs) return { days: new Set(), allWeek: false };
	if (abs.awayWeeks.get(k)?.has(W.num)) return { days: new Set([0, 1, 2, 3, 4, 5, 6]), allWeek: true };
	const out = abs.outDays.get(k);
	const days = new Set<number>();
	if (out) W.dates.forEach((d, i) => d && out.has(+d) && days.add(i));
	return { days, allWeek: days.size === 7 };
}

// =============================================================================
// ANALYSIS (plain code)
// =============================================================================

export function analyze(T: Tracker, W: Week, abs?: Absences): Analysis {
	const target = 5;
	const byDay: Record<string, Set<number>> = {};
	const assigned: Record<string, number> = {};
	for (const s of W.shifts) {
		if (s.who && !NOT_PEOPLE.test(s.who)) {
			const k = key(s.who);
			(byDay[k] ||= new Set()).add(s.dayIdx);
			assigned[k] = (assigned[k] || 0) + s.hours;
		}
	}
	const absent: Record<string, { days: Set<number>; allWeek: boolean }> = {};
	const members: Member[] = T.members.map((m) => {
		const a = (absent[key(m.name)] = absenceIn(abs, m.name, W));
		return {
			...m,
			assignedThisWeek: +(assigned[key(m.name)] || 0).toFixed(2),
			fine: m.officialFine != null ? m.officialFine : Math.max(0, -m.balance) * T.rate,
			away: a.allWeek ? 'away this week' : a.days.size ? `out ${[...a.days].sort().map((d) => DAYS[d]).join(', ')}` : '',
			awayAllWeek: a.allWeek,
		};
	});
	const behind = members.filter((m) => m.balance < 0).sort((a, b) => a.balance - b.balance);
	const open: OpenShift[] = W.shifts
		.filter((s) => s.open)
		.sort((a, b) => (a.dayIdx < 0 ? 9 : a.dayIdx) - (b.dayIdx < 0 ? 9 : b.dayIdx))
		.map((s) => ({ ...s, suggest: [] }));
	const used: Record<string, number> = {};
	for (const s of open) {
		s.suggest = behind
			.filter((m) => {
				const k = key(m.name);
				// Never suggest someone who is away this week, or out on that day.
				const a = absent[k];
				if (a.allWeek || (s.dayIdx >= 0 && a.days.has(s.dayIdx))) return false;
				return !(byDay[k] && byDay[k].has(s.dayIdx)) && (used[k] || 0) < 2;
			})
			.slice(0, 3);
		if (s.suggest[0]) {
			const k = key(s.suggest[0].name);
			used[k] = (used[k] || 0) + 1;
		}
	}
	const noShift = members.filter((m) => m.assignedThisWeek === 0 && m.owed > 0 && !m.awayAllWeek);
	return {
		target,
		members,
		behind,
		open,
		openHours: open.reduce((a, s) => a + s.hours, 0),
		noShift,
		downHours: members.reduce((a, m) => a + Math.max(0, -m.balance), 0),
		fines: members.reduce((a, m) => a + m.fine, 0),
		awayCount: members.filter((m) => m.away).length,
	};
}

// =============================================================================
// VERIFICATION AUDIT (plain code)
// In each weekly tab, the row right after a shift starts with "---verifier"
// and holds the verifier's name for each day. For days already past:
//   Unverified:    an assigned shift with an empty verifier cell
//   Self-verified: the verifier is the person who did the shift
// =============================================================================

export interface AuditIssue {
	member: string;
	shift: string;
	week: number;
	date: Date | null;
	day: string;
	hours: number;
	issue: 'Unverified' | 'Self-verified';
}

export interface Audit {
	issues: AuditIssue[];
	unverified: number;
	selfVerified: number;
	checked: number; // past assigned shift entries looked at
	weeks: number; // weekly tabs with at least one past day
}

export function audit(book: Book, weeks: string[], today = new Date()): Audit {
	const t0 = startOfDay(today);
	const issues: AuditIssue[] = [];
	let checked = 0, weeksSeen = 0;
	for (const sheet of weeks) {
		const W = parseWeek(book, sheet);
		const known = W.dates.filter(Boolean) as Date[];
		if (!known.length || known[0] >= t0) continue;
		weeksSeen++;
		for (const s of W.shifts) {
			if (!s.who || NOT_PEOPLE.test(s.who)) continue;
			// A week-long shift is past once the whole week is.
			const date = s.dayIdx >= 0 ? W.dates[s.dayIdx] : known[known.length - 1];
			if (!date || date >= t0) continue;
			checked++;
			const base = { member: s.who, shift: s.name, week: W.num, date, day: s.dayIdx >= 0 ? s.day : 'Week-long', hours: s.hours };
			if (!s.verifier) issues.push({ ...base, issue: 'Unverified' });
			else if (key(s.verifier) === key(s.who)) issues.push({ ...base, issue: 'Self-verified' });
		}
	}
	// Self-verified first (they can be fined), then most recent first.
	issues.sort((a, b) => (a.issue === b.issue ? +(b.date || 0) - +(a.date || 0) : a.issue === 'Self-verified' ? -1 : 1));
	return { issues, unverified: issues.filter((i) => i.issue === 'Unverified').length, selfVerified: issues.filter((i) => i.issue === 'Self-verified').length, checked, weeks: weeksSeen };
}

// =============================================================================
// HOME IMPROVEMENT (HI) HOURS (plain code) — the "Hab (HI) Hours Tracker" tab
// Each member owes 3h of HI per semester. Only verified hours count: a row (or
// an hours column) needs a verifier who is not the member. Works with a log
// (one row per HI job) or one row per member with hours/verifier columns.
// =============================================================================

export const HI_REQUIRED = 3;

export interface HiMember {
	name: string;
	verified: number;
	owes: number;
}

export interface HiHours {
	tab: string | null;
	note: string;
	members: HiMember[]; // every tracked member, most owed first
	short: HiMember[]; // members with less than HI_REQUIRED verified
	owedTotal: number;
	currentWeek: number;
	totalWeeks: number;
	weeksLeft: number; // including the current week
}

const NOT_VERIFIED = /^(no|n|false|pending|tbd|-+|)$/i;

export function parseHi(book: Book, T: Tracker, weeks: string[], today = new Date()): HiHours {
	const totalWeeks = Math.max(SEMESTER_WEEKS, weeks.length);
	const currentWeek = weeks.length ? parseWeek(book, currentWeek_(book, weeks, today)).num || 1 : 1;
	const weeksLeft = Math.max(0, totalWeeks - currentWeek + 1);
	const done = new Map<string, number>();
	// "Hab (HI) Hours Tracker", "HI Hours", "Home Improvement"… but never the workshift "Hour Tracker".
	const tab = book.sheetNames.find((n) => /\bHI\b|\bhab\b|home\s*improvement/i.test(n)) ?? null;
	let note: string;
	if (!tab) note = 'No HI tab found: every member is shown as owing the full 3h.';
	else {
		const R = book.rows(tab);
		const hi = R.slice(0, 15).findIndex((r) => r && r.some((c) => typeof c === 'string' && /^(name|member|resident)s?$/i.test(c.trim())));
		if (hi < 0) note = `"${tab}" has no Name column: every member is shown as owing the full 3h.`;
		else {
			const H = R[hi].map((c) => (typeof c === 'string' ? c.trim() : ''));
			const nameCol = H.findIndex((c) => /^(name|member|resident)s?$/i.test(c));
			const isHours = (c: string) => /hour|hrs/i.test(c) && !/owed|required|remaining|needed|left|due/i.test(c);
			const isVer = (c: string) => /verif/i.test(c);
			const direct = H.findIndex((c) => isHours(c) && isVer(c)); // e.g. "Verified HI hours"
			const hourCols = H.map((c, j) => (isHours(c) && !isVer(c) ? j : -1)).filter((j) => j >= 0);
			const verCols = H.map((c, j) => (isVer(c) && !isHours(c) ? j : -1)).filter((j) => j >= 0);
			// Each hours column is verified by the first verifier column after it (before the next hours column).
			const pairs = hourCols.map((h, i) => ({ h, v: verCols.find((v) => v > h && (i + 1 >= hourCols.length || v < hourCols[i + 1])) ?? (hourCols.length === 1 && verCols.length === 1 ? verCols[0] : -1) }));
			let rows = 0;
			for (const r of R.slice(hi + 1)) {
				if (!r || typeof r[nameCol] !== 'string' || !r[nameCol].trim() || /^totals?$/i.test(r[nameCol].trim())) continue;
				const k = key(r[nameCol] as string);
				let add = 0;
				if (direct >= 0) add = num(r[direct]) ?? 0;
				else
					for (const { h, v } of pairs) {
						const hrs = num(r[h]);
						if (!hrs) continue;
						const ver = v >= 0 ? r[v] : null;
						const ok = ver === true || (typeof ver === 'string' && !NOT_VERIFIED.test(ver.trim()) && key(ver) !== k);
						if (ok) add += hrs;
					}
				if (add) done.set(k, (done.get(k) || 0) + add);
				rows++;
			}
			note = direct >= 0
				? `"${tab}": verified hours read from the "${H[direct]}" column (${rows} rows).`
				: pairs.length
					? `"${tab}": ${rows} rows, ${pairs.length} hours column(s); only hours with a verifier other than the member count.`
					: `"${tab}" has no hours column that could be read: every member is shown as owing the full 3h.`;
		}
	}
	const members = T.members
		.map((m) => {
			const verified = +(done.get(key(m.name)) || 0).toFixed(2);
			return { name: m.name, verified, owes: +Math.max(0, HI_REQUIRED - verified).toFixed(2) };
		})
		.sort((a, b) => b.owes - a.owes || a.name.localeCompare(b.name));
	const short = members.filter((m) => m.owes > 0);
	return { tab, note, members, short, owedTotal: +short.reduce((a, m) => a + m.owes, 0).toFixed(2), currentWeek, totalWeeks, weeksLeft };
}

// =============================================================================
// DRAFTS (templates, plain code: member data stays in the browser)
// =============================================================================

export function draftHouse(A: Analysis): string {
	const lines = A.open.map((s) => `• ${s.day === 'Any' ? 'Any day' : s.day}: ${s.name} (${s.hours}h)`);
	return (
		`Hi everyone!\n\n${A.open.length} shifts are still on the market this week (${A.openHours}h total):\n${lines.join('\n') || '• none, amazing!'}\n\n` +
		`If you owe hours, this is the easiest way to catch up: sign up in the sheet and grab a verifier when you're done.\n\nThanks for keeping the house running!\n[Workshift manager]`
	);
}

export interface ReportExtras {
	audit?: Audit;
	hi?: HiHours;
}

export function draftManager(A: Analysis, T: Tracker, W: Week, nm: (n: string) => string, x: ReportExtras = {}): string {
	const top = A.behind.slice(0, 5).map((m) => `• ${nm(m.name)}: ${m.balance}h (≈ $${Math.round(m.fine)} if not made up)`).join('\n');
	return (
		`Week of ${fmtDate(W.dates[0]) || W.sheetName}\n\n` +
		`• ${A.open.length} shifts on the market (${A.openHours}h)\n` +
		`• ${A.behind.length} of ${A.members.length} members behind, ${A.downHours.toFixed(1)} down hours in total\n` +
		`• Estimated fines if nothing changes: $${Math.round(A.fines)} (at $${T.rate}/h)\n` +
		`• ${A.noShift.length} members have no shift signed up this week${A.awayCount ? ` (${A.awayCount} away or out some days, never suggested on those days)` : ''}\n` +
		(x.hi ? `• HI hours: ${x.hi.short.length} of ${x.hi.members.length} members still owe ${x.hi.owedTotal}h in total (${HI_REQUIRED}h each per semester), ${x.hi.weeksLeft} weeks left\n` : '') +
		(x.audit ? `• Verification audit (past days): ${x.audit.unverified} shifts unverified, ${x.audit.selfVerified} self-verified${x.audit.selfVerified ? ' (false verification can be fined up to $44/h)' : ''}\n` : '') +
		`\n` +
		`Most behind:\n${top || '• nobody'}\n\nSuggested next steps:\n` +
		`1. Post the open shifts in the house chat (draft ready).\n2. Send the private nudges (drafts ready).\n3. Remind verifiers to sign off before the fining period closes.`
	);
}

export function draftNudge(m: Member, A: Analysis, nm: (n: string) => string): string {
	const s = A.open.find((o) => o.suggest.some((x) => x.name === m.name));
	return (
		`Hi ${nm(m.name).split(' ')[0]}, quick friendly check-in: the tracker shows you ${Math.abs(m.balance)}h behind on workshift this semester ` +
		`(${m.ver}h verified out of ${m.owed}h owed). ` +
		(s ? `"${s.name}" on ${s.day === 'Any' ? 'any day' : s.day} (${s.hours}h) is still open and fits your schedule. ` : '') +
		`If something's going on (exams, health, anything), tell me and we'll find a solution before fines kick in. [Workshift manager]`
	);
}

// =============================================================================
// SAMPLE HOUSE (fictional, generated in code: no real spreadsheet anywhere)
// =============================================================================

/** Small deterministic PRNG so the sample house is the same on every load. */
function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

const SAMPLE_NAMES = ['Avery Brooks', 'Jordan Pike', 'Riley Santos', 'Casey Nguyen', 'Morgan Ellis', 'Taylor Okafor', 'Quinn Harper', 'Rowan Patel', 'Skyler Moreau', 'Hayden Kim'];

const SAMPLE_SHIFTS: { section: string; name: string; hours: number; days: number[] }[] = [
	{ section: 'KITCHEN', name: 'Cook dinner', hours: 3, days: [0, 1, 2, 3, 4] },
	{ section: 'KITCHEN', name: 'Dinner dishes', hours: 1.5, days: [0, 1, 2, 3, 4, 5, 6] },
	{ section: 'KITCHEN', name: 'Lunch prep', hours: 2, days: [0, 1, 2, 3, 4] },
	{ section: 'KITCHEN', name: 'Breakfast setup', hours: 1, days: [0, 2, 4] },
	{ section: 'ERRANDS', name: 'Groceries pickup', hours: 2, days: [5] },
	{ section: 'CLEANING', name: 'Clean bathrooms', hours: 2, days: [1, 4] },
	{ section: 'CLEANING', name: 'Sweep and mop common room', hours: 1.5, days: [2, 5] },
	{ section: 'WEEK-LONG SHIFTS (any day)', name: 'Trash and recycling', hours: 2, days: [0] },
	{ section: 'WEEK-LONG SHIFTS (any day)', name: 'Garden and porch', hours: 2, days: [0] },
];

export const SEMESTER_WEEKS = 17;

/**
 * A fictional house workbook in the BSC template layout: 17 weekly sign-up
 * tabs, Hour Tracker, Fall Occupancy and Hab (HI) Hours Tracker. Dates are
 * placed so that `today` falls in week 7.
 */
export function sampleBook(today = new Date()): Book {
	const rand = rng(42);
	const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
	const t0 = startOfDay(today);
	const monday = new Date(t0);
	monday.setDate(t0.getDate() - ((t0.getDay() + 6) % 7));
	const currentWeek = 7;
	const week1 = new Date(monday);
	week1.setDate(monday.getDate() - 7 * (currentWeek - 1));
	const dayOf = (w: number, d: number) => {
		const x = new Date(week1);
		x.setDate(week1.getDate() + 7 * (w - 1) + d);
		return x;
	};

	// Who is away (hours owed 0) which week, from the occupancy tab.
	const away: Record<string, number[]> = { 'Rowan Patel': [6, 7], 'Hayden Kim': [7], 'Skyler Moreau': [11, 12] };
	// Habitually late members do fewer verified hours.
	const slack: Record<string, number> = { 'Jordan Pike': 0.45, 'Casey Nguyen': 0.6, 'Rowan Patel': 0.5, 'Quinn Harper': 0.8 };
	const owedFor = (n: string, w: number) => ((away[n] || []).includes(w) ? 0 : 5);

	const sheets: Record<string, Cell[][]> = {};
	const verifiedByWeek: Record<string, number[]> = Object.fromEntries(SAMPLE_NAMES.map((n) => [n, Array(SEMESTER_WEEKS + 1).fill(0)]));

	for (let w = 1; w <= SEMESTER_WEEKS; w++) {
		const load: Record<string, number> = Object.fromEntries(SAMPLE_NAMES.map((n) => [n, 0]));
		const R: Cell[][] = [[`WEEK ${w}`], [null, null, ...DAYS]];
		R.push([null, 'Hours', ...DAYS.map((_, d) => dayOf(w, d))]);
		let section = '';
		for (const s of SAMPLE_SHIFTS) {
			if (s.section !== section) {
				section = s.section;
				R.push([section]);
			}
			const row: Cell[] = [s.name, s.hours, null, null, null, null, null, null, null];
			const ver: Cell[] = ['---verifier', null, null, null, null, null, null, null, null];
			for (const d of s.days) {
				const date = dayOf(w, d);
				const past = date < t0;
				const free = SAMPLE_NAMES.filter((n) => owedFor(n, w) > 0);
				// Sign-ups go to whoever has the fewest hours that week (ties broken at random).
				const least = Math.min(...free.map((n) => load[n]));
				let who: string = rand() < (w >= currentWeek ? 0.12 : 0.04) ? 'On Market' : pick(free.filter((n) => load[n] === least));
				if (who !== 'On Market') load[who] += s.hours;
				if (w > currentWeek + 1 && rand() < 0.5) who = '';
				row[2 + d] = who || null;
				if (past && who && who !== 'On Market') {
					const r = rand();
					// Mostly verified by someone else; a few missing or self-verified, as in real houses.
					ver[2 + d] = r < 0.08 ? null : r < 0.11 ? who : pick(SAMPLE_NAMES.filter((n) => n !== who));
					if (ver[2 + d] && rand() < (slack[who] ?? 1)) verifiedByWeek[who][w] += s.hours;
				}
			}
			R.push(row, ver);
		}
		sheets[`WEEK ${w}`] = R;
	}

	// Hour Tracker: Name | (Hours Owed Week n, Verified Week n) x 17 | Name | Rollover | Net | Fine | Processing Fee | Subtotal
	const rate = 22;
	const hdr: Cell[] = ['Name'];
	for (let w = 1; w <= SEMESTER_WEEKS; w++) hdr.push(`Hours Owed Week ${w}`, `Verified Week ${w}`);
	hdr.push('Name', 'Rollover', 'Net', 'Fine', 'Processing Fee', 'Subtotal');
	const included: Cell[] = [null, 'Included'];
	for (let w = 1; w <= SEMESTER_WEEKS; w++) {
		included[2 * w - 1] = w === 1 ? 'Included' : null;
		included[2 * w] = w < currentWeek;
	}
	const tracker: Cell[][] = [['House workshift tracker (sample)', null, null, 'Workshift rate', rate], [], hdr, included, ['(weeks counted toward fines are marked TRUE above)']];
	for (const n of SAMPLE_NAMES) {
		const row: Cell[] = [n];
		let owed = 0, ver = 0;
		for (let w = 1; w <= SEMESTER_WEEKS; w++) {
			const o = owedFor(n, w);
			const v = w < currentWeek ? Math.min(+(verifiedByWeek[n][w]).toFixed(1), 7) : null;
			row.push(o, v);
			if (w < currentWeek) {
				owed += o;
				ver += v ?? 0;
			}
		}
		const rollover = n === 'Morgan Ellis' ? 2 : 0;
		const net = +(ver - owed + rollover).toFixed(1);
		const fine = net < 0 ? Math.round(-net * rate) : 0;
		const fee = fine ? 5 : 0;
		row.push(n, rollover, net, fine, fee, fine + fee);
		tracker.push(row);
	}
	sheets['Hour Tracker'] = tracker;

	// Fall Occupancy: hours owed per member per week (0 = away that week).
	const occ: Cell[][] = [['Fall Occupancy (sample)'], ['Name', ...Array.from({ length: SEMESTER_WEEKS }, (_, i) => `Week ${i + 1}`)]];
	for (const n of SAMPLE_NAMES) occ.push([n, ...Array.from({ length: SEMESTER_WEEKS }, (_, i) => owedFor(n, i + 1))]);
	sheets['Fall Occupancy'] = occ;

	// Hab (HI) Hours Tracker: one row per HI job.
	const hi: Cell[][] = [['Home Improvement hours (3h per member per semester)'], ['Name', 'Date', 'Project', 'Hours', 'Verified by']];
	const projects = ['Paint hallway', 'Fix porch railing', 'Garden beds', 'Clean basement', 'Patch drywall'];
	SAMPLE_NAMES.forEach((n, i) => {
		const jobs = i % 4 === 0 ? 0 : i % 3 === 0 ? 1 : 2;
		for (let j = 0; j < jobs; j++) {
			const date = dayOf(1 + ((i + j * 2) % (currentWeek - 1)), (i + j) % 7);
			const unverified = (i + j) % 5 === 4;
			hi.push([n, date, pick(projects), 1.5, unverified ? null : pick(SAMPLE_NAMES.filter((x) => x !== n))]);
		}
	});
	sheets['Hab (HI) Hours Tracker'] = hi;

	const order = ['Hour Tracker', 'Fall Occupancy', 'Hab (HI) Hours Tracker', ...Array.from({ length: SEMESTER_WEEKS }, (_, i) => `WEEK ${i + 1}`)];
	return { fileName: 'Sample house (fictional)', sheetNames: order, rows: (s) => sheets[s] || [] };
}
