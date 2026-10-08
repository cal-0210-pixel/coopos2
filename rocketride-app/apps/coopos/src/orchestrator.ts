// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * Orchestrator — runs Compliance then Governance. Each agent tries its live
 * RocketRide pipeline first and falls back to the demo agent on any failure
 * (no connection, pipeline error, timeout, malformed JSON). The fallback is
 * recorded in the agent log. Also provides the live pipeline runner for the
 * Workshifts screen (workshift.ts runs its own steps).
 */

import type { PipelineConfig, RocketRideClient } from 'shell';
import complianceJson from '../../../pipelines/compliance.pipe';
import governanceJson from '../../../pipelines/governance.pipe';
import availabilityJson from '../../../pipelines/availability.pipe';
import workshiftMessagesJson from '../../../pipelines/workshift-messages.pipe';
import {
	type Check,
	type Drafts,
	type Input,
	type LogEntry,
	complianceMessage,
	demoCompliance,
	demoGovernance,
	extractJson,
	governanceMessage,
	validateDrafts,
	normalizeChecks,
	verifyQuotes,
	cleanEmail,
} from './agents';
import type { AskPipeline } from './workshift';

// =============================================================================
// PIPELINE RUNNER
// =============================================================================

const LIVE_TIMEOUT_MS = 120_000;

const compliancePipe = complianceJson as unknown as PipelineConfig;
const governancePipe = governanceJson as unknown as PipelineConfig;
const workshiftPipes = {
	availability: availabilityJson as unknown as PipelineConfig,
	messages: workshiftMessagesJson as unknown as PipelineConfig,
};

// use() is expensive: start each pipeline once per session and reuse its token.
const tokens = new Map<PipelineConfig, Promise<string>>();

function tokenFor(client: RocketRideClient, pipeline: PipelineConfig): Promise<string> {
	let t = tokens.get(pipeline);
	if (!t) {
		t = client.use({ pipeline, useExisting: true, ttl: 900 }).then((r) => r.token);
		tokens.set(pipeline, t);
		t.catch(() => tokens.delete(pipeline));
	}
	return t;
}

async function askPipeline(client: RocketRideClient, pipeline: PipelineConfig, message: string): Promise<Record<string, unknown>> {
	const run = async () => {
		const token = await tokenFor(client, pipeline);
		try {
			const res = await client.send(token, message, {}, 'text/plain');
			const answers = res?.answers as unknown[] | undefined;
			if (!answers?.length) throw new Error('Pipeline returned no answer');
			return extractJson(answers[answers.length - 1]);
		} catch (e) {
			tokens.delete(pipeline); // the task may have died; start fresh next time
			throw e;
		}
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${LIVE_TIMEOUT_MS / 1000}s`)), LIVE_TIMEOUT_MS);
	});
	try {
		return await Promise.race([run(), timeout]);
	} finally {
		clearTimeout(timer);
	}
}

/** Live runner for the Workshifts screen: maps its two AI steps to their pipelines. */
export const workshiftAsk =
	(client: RocketRideClient): AskPipeline =>
	(key, message) =>
		askPipeline(client, workshiftPipes[key], message);

// =============================================================================
// AGENTS
// =============================================================================

interface AgentRun<T> {
	result: T;
	log: LogEntry;
}

async function runAgent<T>(
	agent: string,
	action: string,
	client: RocketRideClient | null,
	live: (c: RocketRideClient) => Promise<T>,
	demo: () => T,
	summary: (r: T) => string,
): Promise<AgentRun<T>> {
	const t0 = Date.now();
	let fallback: string | null = client ? null : 'not connected to RocketRide';
	let result: T | undefined;
	if (client) {
		try {
			result = await live(client);
		} catch (e) {
			fallback = String((e as Error)?.message ?? e).slice(0, 200);
		}
	}
	const mode = result !== undefined ? 'live' : 'demo';
	if (result === undefined) result = demo();
	return {
		result,
		log: {
			agent,
			action,
			ms: Date.now() - t0,
			mode,
			summary: summary(result) + (fallback ? ` · Live AI unavailable (${fallback}), used demo agent` : ''),
		},
	};
}

export async function runCompliance(client: RocketRideClient | null, input: Input) {
	const c = await runAgent<Check[]>(
		'Bylaws & Compliance agent',
		'Checked the proposal against the bylaws',
		client,
		async (cl) => normalizeChecks(await askPipeline(cl, compliancePipe, complianceMessage(input))),
		() => demoCompliance(input),
		(checks) => checks.map((x) => `${x.rule}: ${x.status}`).join(' · '),
	);
	// Guardrail (plain code): every quote must be found in the bylaws.
	const t0 = performance.now();
	const v = verifyQuotes(c.result, input.bylaws);
	const quoteLog: LogEntry = {
		agent: 'Quote checker',
		action: 'Verified every quoted bylaw text against the bylaws',
		ms: performance.now() - t0,
		mode: 'code',
		summary: `${v.quoted} quotes checked, ${v.downgraded} not found and downgraded to UNCLEAR`,
	};
	return { result: v.checks, log: c.log, quoteLog };
}

export async function runGovernance(client: RocketRideClient | null, input: Input, checks: Check[]) {
	const g = await runAgent<Drafts>(
		'Governance agent',
		'Drafted motion, GA agenda and notice email',
		client,
		async (c) => validateDrafts(await askPipeline(c, governancePipe, governanceMessage(input, checks))),
		() => demoGovernance(input, checks),
		(d) => `Motion "${d.motion.title}", ${d.agenda.length} agenda items, notice email`,
	);
	// Safety net (plain code): the member email carries no internal warnings.
	const t0 = performance.now();
	const { email, removed } = cleanEmail(g.result.email);
	const cleanLog: LogEntry = {
		agent: 'Email cleaner',
		action: 'Kept the member email free of internal warnings and emojis',
		ms: performance.now() - t0,
		mode: 'code',
		summary: removed.length ? `${removed.length} internal paragraph(s) moved out of the member email` : 'nothing to remove',
	};
	return { result: { ...g.result, email }, log: g.log, cleanLog, removed };
}
