# One-way history fixtures

These are raw Git outputs, not reconstructed schemas. `.json.txt` keeps historical whitespace unchanged through the formatter.

- `attention.diff`: `git show --format= --first-parent -U0 --no-renames b29f3f6 -- lexicons`. The attention prefs snapshot comes from `git show b29f3f6:lexicons/sh/mschf/ratking/attention/prefs.json`. The list snapshots come from that path under `b29f3f6^1` and `b29f3f6`.
- `turn.diff`: `git show --format= -U0 --no-renames de38582 -- lexicons/sh/mschf/agentgraph/turn.json`. Its snapshot comes from `git show de38582:lexicons/sh/mschf/agentgraph/turn.json`.
- `digest.diff`: `git show --format= --first-parent -U0 --no-renames 70b65a9 -- lexicons/sh/mschf/ratking/attention/prefs.json`. Its snapshots come from that path under `70b65a9^1` and `70b65a9`.

- `retire-description.diff`: `git show --format= --first-parent -U0 --no-renames 4c1106d -- packages/pi-ratking/README.md packages/pi-ratking/src/extension.ts`. It retains the README prose and tool-description edit verbatim.
- `retire-move.diff`: a zero-context slice of the deleted/added retire handler in `0dbce4f`, with no-renames path headers. Body lines are copied verbatim from `git show 0dbce4f^1:packages/pi-ratking/src/ratking.ts` (2188–2249) and `git show 0dbce4f:packages/ratking-client/src/ratking.ts` (2677–2738). The two 62-line bodies are byte-identical; only the hunk headers are narrowed to the retained slice.

- `classifier-land.diff`: `git show --format= --first-parent -U0 --no-renames aa4db39 -- stacks/nest/one-way.ts`. This is the verbatim classifier source added by the landing whose live side check initially matched its own regex patterns.

The history property checks the hydrated paths only: attention prefs and mailbox list, the turn record, and the optional digest addition. The CLI replay hydrates every changed lexicon from Git.
