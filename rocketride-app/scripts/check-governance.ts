// Runs the Governance screen's logic (apps/coopos/src/agents.ts) on the sample: live pipelines or demo agents.
// Usage: node --env-file=.env --experimental-strip-types scripts/check-governance.ts [days until GA] [live|demo]
// Expected: 10 days -> 0 FAIL, two-thirds (Section 3.3), quorum 21 of 40; 5 days -> Notice period FAIL (Section 2.2).
import { readFileSync } from 'node:fs';
import { RocketRideClient } from 'rocketride';
import * as G from '../apps/coopos/src/agents.ts';

const days = Number(process.argv[2] ?? 10);
const live = process.argv[3] !== 'demo';
const input: G.Input = {
	bylaws: readFileSync('scripts/sample-bylaws.txt', 'utf8'), memberCount: 40, houseName: '', proposal: 'We want to raise the house food budget by 10%',
	today: new Date().toISOString().slice(0, 10), gaDate: new Date(Date.now() + days * 864e5).toISOString().slice(0, 10),
};

const client = live ? new RocketRideClient({ uri: process.env.ROCKETRIDE_URI, auth: process.env.ROCKETRIDE_APIKEY }) : null;
await client?.connect();
const ask = async (file: string, text: string) => {
	const pipeline = JSON.parse(readFileSync(file, 'utf8'));
	const old = await client!.getTaskToken({ projectId: pipeline.project_id, source: 'webhook_1' }).catch(() => undefined);
	if (old) await client!.terminate(old).catch(() => {});
	const { token } = await client!.use({ pipeline, ttl: 300 });
	const res = await client!.send(token, text, {}, 'text/plain');
	const answers = res?.answers as unknown[];
	return G.extractJson(answers[answers.length - 1]);
};
try {
	const raw = live ? G.normalizeChecks(await ask('pipelines/compliance.pipe', G.complianceMessage(input))) : G.demoCompliance(input);
	const v = G.verifyQuotes(raw, input.bylaws);
	console.log(`GA in ${days} days (${live ? 'live' : 'demo'}): ${v.quoted} quotes, ${v.downgraded} downgraded`);
	for (const c of v.checks) console.log(`  ${c.status.padEnd(7)} ${c.rule} (${c.section}) ${c.explanation.slice(0, 90)}`);
	const drafts = live ? G.validateDrafts(await ask('pipelines/governance.pipe', G.governanceMessage(input, v.checks))) : G.demoGovernance(input, v.checks);
	const { email, removed } = G.cleanEmail(drafts.email);
	console.log(`\nBefore you send: ${v.checks.filter((c) => c.status !== 'PASS').map((c) => `${c.status} ${c.rule}`).join(' · ') || 'nothing'}`);
	console.log(`Email cleaner removed ${removed.length} paragraph(s)${removed.length ? ':\n  - ' + removed.map((r) => r.slice(0, 100).replace(/\n/g, ' ')).join('\n  - ') : ''}`);
	console.log(`\nMEMBER EMAIL\nSubject: ${email.subject}\n\n${email.body}`);
} finally {
	await client?.disconnect();
}
