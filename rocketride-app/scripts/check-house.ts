// Tests the House dashboard logic on the fictional sample house, directly and
// through a real .xlsx round trip (written to a temp folder, never the project).
// Usage: node --experimental-strip-types scripts/check-house.ts [path/to/house.xlsx]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import * as H from '../apps/coopos/src/houseData.ts';
import { readWorkbook } from '../apps/coopos/src/xlsxBook.ts';

function report(book: H.Book, label: string) {
	const weeks = H.weekSheets(book);
	const cur = H.currentWeek(book, weeks);
	const T = H.parseTracker(book);
	const W = H.parseWeek(book, cur);
	const abs = H.parseAbsences(book);
	const A = H.analyze(T, W, abs);
	console.log(`absences: ${abs.note}`);
	console.log(`  away/out this week: ${A.members.filter((m) => m.away).map((m) => `${m.name} (${m.away})`).join(', ') || 'none'}`);
	const bad = A.open.flatMap((s) => s.suggest.filter((m) => m.awayAllWeek || (m.away && m.away.includes(s.day))).map((m) => `${m.name} on ${s.day}`));
	console.log(`  away members suggested: ${bad.length ? 'FAIL ' + bad.join(', ') : 'none (ok)'}`);
	const nm = H.namer(false);
	console.log(`\n== ${label}: ${book.sheetNames.length} tabs, ${weeks.length} weekly, current "${cur}" (${H.fmtDate(W.dates[0])})`);
	console.log(`tracker: ${T.members.length} members, ${T.countedWeeks} counted weeks, rate $${T.rate}, official columns: ${T.official}`);
	console.log(`week: ${W.shifts.length} shift entries, ${A.open.length} open (${A.openHours}h), ${A.behind.length} behind, ${A.downHours.toFixed(1)} down h, fines $${Math.round(A.fines)}, no shift: ${A.noShift.length}`);
	for (const s of A.open) console.log(`  open ${s.day} ${s.name} -> ${s.suggest.map((m) => `${nm(m.name)} (${m.balance}h)`).join(', ') || 'nobody'}`);
	const au = H.audit(book, weeks);
	console.log(`audit: ${au.checked} past shifts in ${au.weeks} weeks -> ${au.unverified} unverified, ${au.selfVerified} self-verified`);
	for (const i of au.issues.filter((i) => i.issue === 'Self-verified').slice(0, 3)) console.log(`  ${i.issue}: ${i.member} · ${i.shift} · ${i.day} ${H.fmtDate(i.date)} (week ${i.week})`);
	console.log('report line:', H.draftManager(A, T, W, nm, { audit: au }).split('\n').find((l) => l.includes('Verification audit')));
	const hi = H.parseHi(book, T, weeks);
	console.log(`HI: ${hi.note}`);
	console.log(`  ${hi.short.length} under ${H.HI_REQUIRED}h: ${hi.short.map((m) => `${m.name} ${m.verified}h (owes ${m.owes}h)`).join(', ')}; ${hi.weeksLeft} weeks left (week ${hi.currentWeek}/${hi.totalWeeks})`);
	console.log('  report line:', H.draftManager(A, T, W, nm, { audit: au, hi }).split('\n').find((l) => l.includes('HI hours')));
	return { T, W, A, weeks, cur, au, hi };
}

const direct = report(H.sampleBook(), 'sample (in code)');

// .xlsx round trip of the sample, the same path an upload takes.
const dir = mkdtempSync(join(tmpdir(), 'coopos-'));
try {
	const book = H.sampleBook();
	const wb = XLSX.utils.book_new();
	for (const s of book.sheetNames) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(book.rows(s), { cellDates: true }), s);
	const file = join(dir, 'sample.xlsx');
	writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
	const back = readWorkbook(XLSX, readFileSync(file).buffer as ArrayBuffer, 'sample.xlsx');
	const rt = report(back, 'sample (.xlsx round trip)');
	const same = JSON.stringify([rt.A.open.length, rt.A.behind.length, Math.round(rt.A.fines), rt.cur, rt.au.unverified, rt.au.selfVerified]) === JSON.stringify([direct.A.open.length, direct.A.behind.length, Math.round(direct.A.fines), direct.cur, direct.au.unverified, direct.au.selfVerified]);
	console.log('round trip matches:', same ? 'ok' : 'MISMATCH');
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (process.argv[2]) report(readWorkbook(XLSX, readFileSync(process.argv[2]).buffer as ArrayBuffer, process.argv[2]), 'real file');

// Days-out layout: same sample, occupancy tab rewritten as day columns with "out" marks.
{
	const b = H.sampleBook();
	const weeks = H.weekSheets(b);
	const W = H.parseWeek(b, H.currentWeek(b, weeks));
	const T = H.parseTracker(b);
	const firstOpen = H.analyze(T, W).open[0];
	const target = firstOpen.suggest[0].name; // the top suggestion before absences
	const occ: H.Cell[][] = [['Name', ...W.dates], ...T.members.map((m) => [m.name, ...W.dates.map((_, i) => (m.name === target && i === firstOpen.dayIdx ? 'out' : null))])];
	const book: H.Book = { ...b, rows: (s) => (/occupancy/i.test(s) ? occ : b.rows(s)) };
	const abs = H.parseAbsences(book);
	const A = H.analyze(T, W, abs);
	const still = A.open.find((s) => s.name === firstOpen.name && s.day === firstOpen.day)!.suggest.some((m) => m.name === target);
	console.log(`\n== days-out layout: ${abs.note}`);
	console.log(`  ${target} marked out ${firstOpen.day}: ${A.members.find((m) => m.name === target)!.away}; still suggested for ${firstOpen.name} ${firstOpen.day}: ${still ? 'FAIL' : 'no (ok)'}`);
}

// HI per-member layout: Name | HI 1 hours | HI 1 verifier | HI 2 hours | HI 2 verifier (self-verified must not count).
{
	const b = H.sampleBook();
	const T = H.parseTracker(b);
	const [a, c] = [T.members[0].name, T.members[1].name];
	const tab: H.Cell[][] = [['Name', 'HI 1 hours', 'HI 1 verifier', 'HI 2 hours', 'HI 2 verifier'], [a, 2, c, 1, c], [c, 2, c, 1.5, a]];
	const book: H.Book = { ...b, rows: (s) => (/\(HI\)/.test(s) ? tab : b.rows(s)) };
	const hi = H.parseHi(book, T, H.weekSheets(book));
	const get = (n: string) => hi.members.find((m) => m.name === n)!;
	const ok = get(a).verified === 3 && get(c).verified === 1.5;
	console.log(`\n== HI per-member columns: ${hi.note}\n  ${a}: ${get(a).verified}h (expect 3), ${c}: ${get(c).verified}h (expect 1.5, self-verified 2h excluded) -> ${ok ? 'ok' : 'FAIL'}`);
}
