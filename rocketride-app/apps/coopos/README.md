# CoopOS

An AI back office for student housing co-ops, starting with the Berkeley Student Cooperative.

## What it does

Fill in one form: your bylaws (paste or upload a .txt file), the number of voting members, the date of the next General Assembly, and a proposal in plain language, such as "We want to raise the house food budget by 10%". Click **Check and draft** and you get:

- **Bylaw check**: each rule (who can propose, notice period, quorum, vote threshold, committee review) marked PASS, FAIL or UNCLEAR, with the exact quoted bylaw section and a one sentence explanation.
- **Draft motion**: title, Whereas clauses, Be it resolved clauses, proposer and seconder placeholders, and the vote required.
- **Draft GA agenda** and a **draft notice email**.
- **Agent log**: which agent did what.

On the **Workshifts** screen, add the house's members as cards: click the days each one can't do and what they like or avoid, enter the hours they did last week, and add any other note in plain words. List this week's shifts (task, day, hours). Already have a spreadsheet? Import members and shifts from CSV. Click **Build this week's plan** and you get:

- **This week's plan**: a week grid of shifts assigned fairly, respecting availability, preferences and the hours each member owes, with any shift that cannot be filled flagged.
- **Members**: hours this week against the target, last week's hours, and the constraints the AI read from each note.
- **Announcement** for the house and **kind reminders** for members who were under target last week.
- **Agent log**.

Every output has a Copy button.

On the **House dashboard**, drop the house's BSC workshift spreadsheet (.xlsx). It is read in your browser and never uploaded. Pick a week (the current one is chosen for you) and get:

- **KPIs**: members tracked, shifts on the market, members behind, down hours, estimated fines, and past shifts unverified or self-verified.
- **Shifts on the market** with suggested takers: members who owe hours and are free that day, never someone away or out that day (from the occupancy tab).
- **Members behind on hours**, using the tracker's own Net, Fine and Subtotal columns when present.
- **Verification audit**: past shifts with no verifier, and shifts verified by the person who did them.
- **Home Improvement (HI) hours**: who still owes part of their 3h this semester, and how many weeks are left.
- A **message to the house**, a **report for the workshift manager** and **personal nudges**, all drafts. "Anonymize names" is on by default for demos.

No member data from the spreadsheet is sent to an AI: everything on this screen is plain code running in your browser. Try it with the fictional sample house.

## Guardrails

- The AI drafts and checks. Humans decide. Nothing is sent automatically.
- Bylaw text is never invented. Every quote the AI returns is checked against your bylaws, and any quote that cannot be found is downgraded to UNCLEAR.
- If the live AI is unavailable, rule based demo agents run instead, and the log says so. The agent log on every screen shows each step, how long it took, and whether it was AI or plain code.
- Anything the organizer must check (FAIL or UNCLEAR rules) is shown in a separate "Before you send" box, never in the member email.
- Every screen has a **Reset demo** button that restores the sample data.

## How it works

Two RocketRide pipelines (Webhook → Claude → Return Answers): `compliance.pipe` checks the proposal against the bylaws, and `governance.pipe` drafts the motion, agenda and email from the checks. The app runs Compliance, then Governance, then hands the result to a human, showing progress at each step.

Workshifts uses two more pipelines: `availability.pipe` turns members' notes into structured availability, and `workshift-messages.pipe` drafts the announcement and reminders. The scheduling in between is plain code, not AI: the AI understands messy human input, code does the math.
