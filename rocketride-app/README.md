# CoopOS on RocketRide

CoopOS is an AI back office for student housing co-ops, starting with the Berkeley Student Cooperative. The AI drafts and checks; humans decide. Nothing is ever sent automatically.

This folder is the RocketRide version of the prototype in `app/`: a React app that runs on the RocketRide platform, with its AI steps as RocketRide pipelines.

## The 3 screens

- **Governance**: bylaws, number of voting members, GA date and a proposal in plain language in; a bylaw check (PASS / FAIL / UNCLEAR, each with the exact quoted section), a draft motion, GA agenda and member notice email out. Anything the organizer must resolve goes in a separate "Before you send" box, never in the member email. Every quote is checked against the bylaws in code; a quote that cannot be found is downgraded to UNCLEAR.
- **Workshifts**: member cards (days they can't do, likes and avoids, a free note) and this week's shifts, or a CSV import; out comes a fair weekly plan, an announcement and kind reminders for members under target last week. The AI reads the notes; the scheduler is plain code.
- **House dashboard**: drop the house's BSC workshift spreadsheet (.xlsx). It is read in the browser only and never uploaded, and no member data goes to an AI. Shows open shifts with suggested takers, members behind on hours and fines, a verification audit (unverified and self-verified shifts), absences, Home Improvement hours, and draft messages. Names are anonymized by default. A fictional sample house is built in.

Every screen has an agent log (each step, its time, AI or plain code) and a Reset demo button. If a pipeline fails, a rule based demo agent takes over and the log says so.

## Pipelines

Each is Webhook → Prompt (system prompt) → Anthropic Claude → Return Answers, in `pipelines/`:

| Pipeline | Used by | Returns |
|---|---|---|
| `compliance.pipe` | Governance | `{"checks":[{"rule","status","section","quote","explanation"}]}` |
| `governance.pipe` | Governance | `{"motion":{...},"agenda":[...],"email":{"subject","body"}}` |
| `availability.pipe` | Workshifts | `{"members":[{"name","unavailableDays","prefers","avoids"}]}` |
| `workshift-messages.pipe` | Workshifts | `{"announcement":{"subject","body"},"reminders":[{"to","body"}]}` |

The app embeds them and runs them through the platform connection (`client.use` + `client.send`).

## Layout

```
apps/coopos/     the RocketRide app (React, platform shell)
pipelines/       the four .pipe files
scripts/         test and lifecycle scripts
```

## How to run it

Requirements: Node 22+, pnpm, and a RocketRide account.

1. In this folder, run `rocketride init` (from the `rocketride` package). It signs you in, writes `.env`, and vendors the platform packages into `.rocketride/`, which the app's `package.json` points to.
2. `pnpm install`
3. Check the pipelines: `pnpm validate`
4. Develop: open `apps/coopos/coopos.rrapp` in the RocketRide extension (App Builder) for a live preview.
5. Test the app logic with the sample data:
   - `pnpm check:governance 10 live` (expect 0 FAIL) and `pnpm check:governance 5 live` (expect Notice period FAIL, Section 2.2). Use `demo` instead of `live` to run without the AI.
   - `pnpm check:workshift live` (expect 12/12 shifts filled, reminders to Leo, Sam, Ava)
   - `pnpm check:house` (sample house; pass a path to an .xlsx kept outside this repo to test a real one)
6. Ship: `rocketride app deploy ./apps/coopos`, then `node --env-file=.env scripts/publish.mjs <version> @me`. The app id is `coopos_lab.coopos`; change it in `apps/coopos/package.json`, `coopos.rrapp` and `src/AppDescriptor.ts` for another developer namespace.

## Environment variables

Names only; see `.env.example`. Never commit `.env`.

| Variable | Where | Purpose |
|---|---|---|
| `ROCKETRIDE_URI` | `.env` | Development server address |
| `ROCKETRIDE_APIKEY` | `.env` | Development server key |
| `ROCKETRIDE_DEPLOY_URI` | `.env` | Deployment target address |
| `ROCKETRIDE_DEPLOY_APIKEY` | `.env` | Deployment target key |
| `ROCKETRIDE_ANTHROPIC_KEY` | RocketRide account secrets (server side) | Claude key used by the pipelines, set in your RocketRide environment, not in this repo |

## Privacy

Spreadsheets (`*.xlsx`, `*.xls`, `*.csv`) and `.env` are git-ignored. Real member data stays in the browser. All names in the sample data are fictional.
