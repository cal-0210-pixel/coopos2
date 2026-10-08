# CoopOS

CoopOS is an AI back office for student housing co-ops, starting with the Berkeley Student Cooperative.
It turns the volunteer admin work (motions, GA agendas, workshifts, hour tracking) into drafts and checks in seconds.
The AI drafts and checks; humans decide. Nothing is ever sent automatically.

## The 3 screens

- **Governance**: paste your bylaws, the number of voting members, the GA date and a proposal in plain language. Get a bylaw check (PASS / FAIL / UNCLEAR, each with the exact quoted section), a draft motion, a GA agenda and a member notice email. Anything the organizer must fix goes in a separate "Before you send" box.
- **Workshifts**: add members (days they can't do, likes and avoids, a free note) and this week's shifts, or import them from CSV. Get a fair weekly plan, an announcement and kind reminders for members who were under their hours last week.
- **House dashboard**: drop the house's workshift spreadsheet (.xlsx). It is read in your browser and never uploaded. See open shifts with suggested takers, members behind on hours and fines, a verification audit, absences, Home Improvement hours and draft messages.

## Where to look

| Folder | What it is |
|---|---|
| [`rocketride-app/`](rocketride-app/) | The main app: the RocketRide app with all 3 screens, plus its 4 AI pipelines and test scripts. Start here. |
| [`app/`](app/) | The first prototype: a plain Node server and HTML pages (Governance and Workshifts first, then the House dashboard). |
| [`docs/`](docs/) | The spec ([`company.md`](docs/company.md)) and the sample bylaws used for testing. |

## How to run it

**The RocketRide app** (needs Node 22+, pnpm and a RocketRide account). Full details are in [`rocketride-app/README.md`](rocketride-app/README.md).

```
cd rocketride-app
rocketride init          # signs you in and writes .env (see .env.example for the variable names)
pnpm install
pnpm validate            # checks the 4 pipelines
```

Then open `apps/coopos/coopos.rrapp` in the RocketRide extension for a live preview, or ship it with `rocketride app deploy ./apps/coopos`. The pipelines also need `ROCKETRIDE_ANTHROPIC_KEY` set in your RocketRide account (server side, never in this repo).

**The prototype** (needs Node 18+, nothing to install):

```
node app/server.js
```

Open http://localhost:3000. It runs offline with demo agents; for live AI, put `ANTHROPIC_API_KEY` (or `KYLON_API_KEY`) in `app/.env`. See [`app/README.md`](app/README.md).

Never commit `.env` files or real house spreadsheets: both are git-ignored.
