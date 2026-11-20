# Dyon

Send the same coding task to Claude Code and Codex, watch both work side by side, and compare the results.

## Requirements

- Node.js 22.13 or newer
- git (each workspace is a git repository, used to compute what a turn changed)
- An Anthropic API key and an OpenAI API key
- Ports 3000, 3001 and 3002 free on your machine (web app, worker, live relay)

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in both keys
npm run dev
```

`npm run dev` starts three processes: the web app on http://localhost:3000, the worker that runs the agents on port
3001, and the live relay on port 3002 (a local Cloudflare worker, through wrangler). Checks: `npm run typecheck && npm test`.

A missing key does not stop the app: the runs of that agent fail at once with a message saying which key to add, and
the other agent's runs go on.

## Use it

1. Type a task, or pick one of the example tasks under the box.
2. Choose the competitors: each agent with a model and an effort level, up to 3 (the same agent twice is allowed).
3. Optional:
   - **×1, ×3, ×5**: runs per competitor. Several runs show how much results vary.
   - **Blind**: names stay hidden ("Competitor A") until you give a verdict.
   - **Check**: a shell command run in each workspace after each turn. Exit code 0 means passed. The agents never
     see it, so it can hold hidden tests.
4. Follow every step live: messages, reasoning, commands and their output, file edits, web searches, other tools.
   Each run has a Timeline, the Changes of the turn and the Files of its workspace.
5. Send follow-ups: every agent continues its own session in its own workspace. Stop a turn at any time.
6. Give your verdict, open the read-only report (`/report/<id>`) and look at the scoreboard of past runs.

A comparison has its own link (`?c=<id>`): a refresh, a second tab or a restart keeps it. The worker sends a sign of
life every 5 seconds while it runs a turn; a turn without one for 60 seconds is closed with a message. A follow-up
is then accepted, and continues from the files and agent sessions saved at the end of the last finished turn.

### Example tasks

| Task         | What it tests                                                          | Hidden check                                                     |
| ------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A mini game  | Building a small app from a short description                          | None: whether it plays well is for you to judge                  |
| An algorithm | Earliest arrival through a timetable with transfers, to a precise spec | Edge cases of the spec, and 50,000 connections in under a second |
| Fix a bug    | Finding and fixing several bugs in existing code                       | One assertion per rule of the spec                               |

## How it measures

Every figure is marked with where it comes from:

- **M**, measured by Dyon: wall-clock time of each run, files changed and lines added or removed (git, per turn),
  the check result.
- **R**, reported by the agent: tokens (input, cache reads and writes, output, reasoning), actions, the model used,
  and Claude Code's own cost figure.
- **D**, derived by Dyon: cost, computed from the reported tokens and the providers' published list prices, the same
  way for every agent. Codex reports no cost.

Price sources, read on 2026-11-20 (`lib/domain/pricing.ts`):

- Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
- OpenAI: https://developers.openai.com/api/docs/pricing

For Claude Code the derived cost matches the agent's own figure. Codex's web actions are not priced: Codex reports
searches, page opens and finds alike, without saying which were billed. How many were left out is shown.

One run per competitor is an observation, not a verdict. With 3 or 5 runs, the comparison shows the median and the
range. The scoreboard groups first-turn runs by agent, model and effort, with the check pass rate and its 95% Wilson
interval.

## How the code is organized

```
app/                 Next.js pages, API routes and components
  api/comparisons/   create, follow-ups, stop, verdict, files of a run
  report/[id]/       the read-only report
lib/domain/          pure logic shared by server and browser: types, record reducer, metrics, pricing, stats
lib/agents/          one adapter per agent, behind the AgentSession interface (claude.ts, codex.ts),
                     and the pure mappers from each SDK's events to timeline steps (*-map.ts)
  api/worker/[id]/    the worker's API: claim a turn, progress, links to store run files
lib/server/          store (SQLite locally, Postgres with DATABASE_URL), file storage (a folder, or Cloud Storage),
                     tokens, dispatch to the worker, workspaces, catalog
worker/              the worker: runs a turn through the web app's API (a local process, or one Cloud Run Job
                     execution per turn), publishes its events
party/               the live relay: one room per comparison, on Cloudflare
tests/               vitest, including replays of recorded agent sessions (tests/fixtures)
```

- Each agent runs through its official SDK (Claude Agent SDK, Codex SDK), with no approval prompts, none of the
  machine's own settings, and an environment holding only its own key.
- The models and effort levels offered come from the agents themselves, not from a list kept in this repository.
- Turns run in a separate worker process, never in the web app: a turn runs for minutes and executes the agents'
  commands. The web app hands it a turn; the worker reports the agents' models, saves each turn's progress and
  publishes its numbered events to the comparison's room on the relay, which passes them to every open tab. The
  relay keeps nothing: a tab that misses events reloads the saved state.
- The worker holds no database, storage or relay credentials: the agents run commands on its machine. The web app
  gives it a 45-minute token for one comparison; with it, the worker claims the turn, sends its progress (the
  answer carries a stop request) and gets short-lived links to upload each run's files and agent session after
  every turn. A follow-up can then run on any machine.
- Only the web app holds the relay's secret. It gives each tab a 10-minute token to join one room, and the worker a
  token to publish to the room of the turn it runs.

## Known limits

- Agents run on your machine with your user's rights, in a folder of the system temp directory. They are not
  isolated from the rest of the machine: run only tasks you would run with these agents directly.
- A stopped run reports no tokens or cost for its turn: the agents report them only when a turn ends.
- A turn stops after 20 minutes. Claude Code also stops at 50 turns or $5 per turn.
- Single user, local only: no accounts, no hosting.
