# Dyon

Send the same coding task to Claude Code and Codex, watch both work side by side, and compare the results.

Hosted at https://dyon.ftane.com (the link with its access token is shared separately).

## Requirements

- Node.js 22.13 or newer (`.nvmrc`: `nvm use`)
- git (each workspace is a git repository, used to compute what a turn changed)
- An Anthropic API key and an OpenAI API key
- Ports 3000, 3001 and 3002 free on your machine (web app, worker, live relay)

Nothing else: no Docker, no database server, no cloud account.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in both keys
npm run dev
```

`npm run dev` starts three processes: the web app on http://localhost:3000, the worker that runs the agents on port
3001, and the live relay on port 3002 (a local Cloudflare worker, through wrangler). The secrets these three share are
generated on the first start and kept in `.dyon/dev-secrets.json`. Checks: `npm run typecheck && npm test`.

A missing key does not stop the app: the runs of that agent fail at once with a message saying which key to add, and
the other agent's runs go on. Keys typed in the Keys box take precedence over `.env.local`.

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

The three cover different kinds of work (building from scratch, following a precise spec, changing existing code).
The tasks are written for Dyon rather than taken from known exercises, which the models may have seen in training, and
two of them come with a check that gives an objective pass or fail.

## What it measures, and why

The question Dyon answers is "given this task, which agent should I use?". A developer weighs whether the work is
right, how long they wait, what it costs, and how the agent got there. Each figure below serves one of these, and is
marked with where it comes from, so that a reported number is never presented as a measured one:

- **M**, measured by Dyon;
- **R**, reported by the agent;
- **D**, derived by Dyon from reported values.

| Metric                                                       | Source | Why                                                                                                                                                 |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Check result (pass or fail)                                  | M      | Whether the work is right, decided by a command the agents never see, so they cannot write to it.                                                   |
| Your verdict                                                 | you    | Quality that no command measures (readability, the game being fun). Blind mode keeps names from swaying it.                                         |
| Wall-clock time per run                                      | M      | What you wait. Measured the same way for both agents, from start to end of the run.                                                                 |
| Cost                                                         | D      | What you pay. Codex reports no cost, so both are computed the same way: reported tokens × published list prices. Claude Code's own figure is shown. |
| Tokens (input, cache reads and writes, output, reasoning)    | R      | Effort independent of prices, and where the cost comes from (a run mostly reading its cache costs far less).                                        |
| Actions by kind (commands, reads, edits, web, other, failed) | R      | How the agent worked: whether it explored, tested what it wrote, or kept retrying failing commands.                                                 |
| Files changed, lines added and removed                       | M      | The size of the change, from git: an agent rewriting files it did not need to touch shows here.                                                     |
| Median and range over 3 or 5 runs                            | M, D   | Agents give different results each time: one run is an observation, not a verdict.                                                                  |
| Check pass rate with its 95% Wilson interval (scoreboard)    | M      | Pass rates over few runs are uncertain; the interval says how much (3 passes out of 3 still spans 44% to 100%).                                     |

Price sources, read on 2026-11-20 (`lib/domain/pricing.ts`):

- Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
- OpenAI: https://developers.openai.com/api/docs/pricing

For Claude Code the derived cost matches the agent's own figure. Codex's web actions are not priced: Codex reports
searches, page opens and finds alike, without saying which were billed. How many were left out is shown.

## API keys

- **Locally**, the agents use the keys of `.env.local`, or the ones typed in the Keys box.
- **Hosted**, every turn runs on the visitor's own keys; the server's keys are never used for a turn. The Keys box
  opens when a key is missing.

How a visitor's key travels:

1. The browser keeps it in `sessionStorage`: in that tab only, forgotten when the tab closes, never in a cookie or a
   URL.
2. It is sent with each turn (create or follow-up), over HTTPS.
3. The server encrypts it (AES-256-GCM, with `KEYS_SECRET`) and stores it on the queued turn only.
4. When a worker claims the turn, the server decrypts the keys, hands them over and deletes them from the database in
   the same transaction. They are never returned by the API to a browser, and never logged.
5. The worker gives each agent only its own key, in the environment of that agent's process.

Hosted, the server holds one Anthropic key for one purpose: listing the models offered in the picker.

## How it runs

```
browser ──── web app (Next.js) ──── database (SQLite locally, Postgres hosted)
   │              │    │
   │              │    └──── run files (a folder locally, Cloud Storage hosted)
   │              │
   │        worker API (one token per comparison)
   │              │
   │           worker ──── Claude Code, Codex (official SDKs), one workspace per run
   │              │
   └──── live relay (one room per comparison) ◄── the worker's events
```

- Each agent runs through its official SDK (Claude Agent SDK, Codex SDK), with no approval prompts, none of the
  machine's own settings, and an environment holding only its own key.
- The models and effort levels offered come from the agents themselves, not from a list kept in this repository.
- Turns run in a separate worker, never in the web app: a turn runs for minutes and executes the agents' commands.
  Locally the worker is a process; hosted, each turn is one execution of a Cloud Run Job.
- The worker holds no database, storage or relay credentials, since the agents run commands on its machine. The web
  app gives it a 45-minute token for one comparison; with it, the worker claims the turn, sends its progress (the
  answer carries a stop request) and gets short-lived links to upload each run's files and agent session after every
  turn. A follow-up can then run on any machine.
- The relay passes the worker's numbered events to every open tab and keeps nothing: a tab that misses events reloads
  the saved state. Only the web app holds the relay's secret; it gives each tab a 10-minute token to join one room,
  and the worker a token to publish to the room of the turn it runs.

Hosted on Vercel (web app), Neon (Postgres), Google Cloud (Cloud Storage, the Cloud Run Job `dyon-worker`) and
Cloudflare (the relay). The worker image is built from `Dockerfile.worker` with `cloudbuild.yaml`.

### Code layout

```
app/                 Next.js pages, API routes and components
  api/comparisons/   create, follow-ups, stop, verdict, files of a run
  api/worker/        the worker's API: claim a turn, progress, links to store run files, the models
  report/[id]/       the read-only report
lib/domain/          pure logic shared by server and browser: types, record reducer, metrics, pricing, stats
lib/agents/          one adapter per agent, behind the AgentSession interface (claude.ts, codex.ts),
                     and the pure mappers from each SDK's events to timeline steps (*-map.ts)
lib/server/          store, file storage, tokens, keys, dispatch to the worker, workspaces, catalog
worker/              the worker: runs a turn through the web app's API, publishes its events
party/               the live relay, on Cloudflare
tests/               vitest, including replays of recorded agent sessions (tests/fixtures)
docs/security.md     what an agent can reach when hosted, measured
```

## Security

- **Access**: the hosted app answers only to a link carrying its access token (kept in a cookie afterwards). Reports
  (`/report/<id>`) are readable by anyone with their link.
- **Isolation of runs** (hosted): the worker runs each agent as its own Linux user, with its workspace and agent
  home readable by that user only. Claude Code runs in its sandbox (bubblewrap), Codex in its `workspace-write` sandbox. The worker's
  cloud account has no role on the project.
- **Browser**: a strict Content Security Policy (a nonce per page, connections to this site and the relay only), so
  text written by an agent cannot run as a script or send keys elsewhere. Agent output is always shown as text.

`docs/security.md` lists what a command run by an agent could reach, measured on the hosted deployment before and
after this isolation.

## Known limits

- **Locally**, agents run with your user's rights, in a folder of the system temp directory, not isolated from the
  rest of the machine: run only tasks you would run with these agents directly.
- **An agent can read its own API key** from its environment while it runs (measured for Codex, see
  `docs/security.md`). Use keys you can revoke, ideally with a spending limit.
- **Agents can reach the internet** (they need it for packages and web searches).
- **A hosted turn waits about 1 to 2.5 minutes** before starting: the time Cloud Run takes to start an execution. The
  worker itself claims the turn within a second of starting.
- A stopped run reports no tokens or cost for its turn: the agents report them only when a turn ends.
- A turn stops after 20 minutes. Claude Code also stops at 50 turns or $5 per turn.
- If a worker dies mid-turn, the work of that turn is lost; the next follow-up starts from the last finished turn.
- One shared access token, no accounts.

## With more time

- **A key proxy**: give agents a short-lived token instead of the real API key, so that an agent reading its own
  environment gets nothing reusable.
- **Outbound network allow-listing**: let agents reach only package registries and the documentation sites they need.
- **A warm worker pool**, to start hosted turns in seconds instead of minutes.
- **Resuming a turn after a crash**, from snapshots taken during the turn rather than only at its end.
- **Tokens and cost of stopped runs**, by reading the agents' session files when the SDKs report nothing.
- **Automated tests of the worker and the API routes** end to end (today: unit tests and replays of recorded sessions).
- **Accounts and per-user quotas**, instead of one shared access token.
- **A larger set of example tasks** with hidden checks, run many times each, to rank agents on more than single
  observations.
