# What an agent can reach when hosted

An agent runs shell commands on the worker's machine. This file records what such a command can reach, measured
on the hosted deployment, and what each measure changed. Values of secrets are never printed: the probe reports
names, status codes and yes or no only.

## How it was measured

Both agents first refused to run the probe as a task (each called it credential harvesting). It was run instead as
the hidden check of a comparison: the check runs on the same machine, as the same user and with the same
environment as the agents' own commands, so it reaches exactly what they reach. The probe:

- lists the names of its own environment variables, and of the worker's variables it can read in other processes;
- lists the worker's files and the run folders it can read;
- asks the cloud metadata server for the worker's service account and a token, then tries that token on the run
  files bucket, the Cloud Run jobs, the project and its service accounts;
- tries outbound HTTPS.

## Results (2026-11-20, Cloud Run Job, both agents)

| What                                     | Before (one user for everything)                          | After (one user per run, sandboxes)           |
| ---------------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| User of the agent's commands             | `dyon` (uid 10001), same as the worker                    | `agent0`, `agent1`… (uid 20000+), one per run |
| Own environment                          | `HOME LANG PATH PWD SHLVL TMPDIR`                         | same                                          |
| Worker process environment               | readable: `WORKER_TOKEN`, `COMPARISON_ID`, `DYON_API_URL` | `Permission denied`                           |
| Other run's workspace and agent home     | readable                                                  | not listable (`/work` is 711, each run 700)   |
| Worker files (`/app`)                    | readable (the bundled worker, no secrets)                 | readable (same)                               |
| Metadata server                          | service account `dyon-worker`, token obtained             | same                                          |
| That token on bucket, jobs, project, IAM | 403, 403, 403, 403                                        | 403, 403, 403, 403                            |
| Outbound HTTPS                           | open (200)                                                | open (200)                                    |

The worker's service account has no role on the project: a token from the metadata server opens nothing. The
worker itself holds no database, storage or relay credential; its only secret is a token for one comparison, valid
45 minutes, now out of the agents' reach.

## What is still reachable

- **Each agent's own API key.** Codex's commands can read it: during the run after isolation, Codex read the start
  of `CODEX_API_KEY` from the environment of its own process (its own key, for this turn). Claude Code's sandbox
  removes `ANTHROPIC_API_KEY` from its commands' environment.
- **The network.** Commands can reach any host, as both agents need for installing packages and web searches.
- **The cloud metadata server.** It answers, but its token has no permission.
