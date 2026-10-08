// Runs the app's workshift module on the sample data.
// Usage: node --env-file=.env --experimental-strip-types scripts/check-workshift.ts [demo|live]
// Expected: 12/12 shifts filled, 3 reminders (Leo, Sam, Ava).
import { readFileSync } from 'node:fs';
import { RocketRideClient } from 'rocketride';
import { type AskPipeline, SAMPLE_MEMBER_ROWS, SAMPLE_SHIFT_ROWS, csvToMembers, csvToShifts, membersText, nextMonday, runWorkshift, shiftsText } from '../apps/coopos/src/workshift.ts';

const live = process.argv[2] === 'live';
const input = { members: membersText(SAMPLE_MEMBER_ROWS), shifts: shiftsText(SAMPLE_SHIFT_ROWS), targetHours: 4, houseName: '', weekOf: nextMonday() };
console.log('members text sent to the agents:\n' + input.members);
// CSV import: same sample as a spreadsheet export (with header row) must round-trip to the same shifts text.
const csv = 'Task,Day,Hours\n' + shiftsText(SAMPLE_SHIFT_ROWS).split('\n').map((l) => l.split(' | ').join(',')).join('\n');
console.log('shifts CSV round-trip:', shiftsText(csvToShifts(csv)) === input.shifts ? 'ok' : 'MISMATCH');
console.log('members CSV:', JSON.stringify(csvToMembers('Name;Last week;Notes\nMaya;4;prefers kitchen;no Thursdays')));
const files = { availability: 'pipelines/availability.pipe', messages: 'pipelines/workshift-messages.pipe' };

let client: RocketRideClient | null = null;
let ask: AskPipeline | null = null;
if (live) {
	client = new RocketRideClient({ uri: process.env.ROCKETRIDE_URI, auth: process.env.ROCKETRIDE_APIKEY });
	await client.connect();
	ask = async (key, message) => {
		const pipeline = JSON.parse(readFileSync(files[key], 'utf8'));
		const old = await client!.getTaskToken({ projectId: pipeline.project_id, source: 'webhook_1' }).catch(() => undefined);
		if (old) await client!.terminate(old).catch(() => {});
		const { token } = await client!.use({ pipeline, ttl: 300 });
		const res = await client!.send(token, message, {}, 'text/plain');
		const answers = res?.answers as unknown[] | undefined;
		const a = answers?.[answers.length - 1];
		if (a && typeof a === 'object') return a as Record<string, unknown>;
		const m = String(a ?? '').match(/\{[\s\S]*\}/);
		if (!m) throw new Error('Model did not return JSON');
		return JSON.parse(m[0]);
	};
}
try {
	const r = await runWorkshift(input, ask, (s) => console.log('step', s));
	console.log('people:', r.people.map((p) => `${p.name} off[${p.unavailableDays}] prefers[${p.prefers}] avoids[${p.avoids}]`).join(' | '));
	console.log(`filled: ${r.assignments.length}/${r.assignments.length + r.unfilled.length}`);
	console.log('assignments:', r.assignments.map((a) => `${a.day} ${a.name}->${a.member}`).join('; '));
	console.log('loads:', r.members.map((m) => `${m.name} ${m.hours}/${m.target}`).join(', '));
	console.log('reminders to:', r.reminders.map((x) => x.to).join(', '));
	console.log('announcement subject:', r.announcement.subject);
	for (const l of r.log) console.log(`log: [${l.mode}] ${l.agent}: ${l.summary}`);
} finally {
	await client?.disconnect();
}
