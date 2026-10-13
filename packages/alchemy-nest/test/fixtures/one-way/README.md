# One-way history fixtures

These are raw Git outputs, not reconstructed schemas. `.json.txt` keeps historical whitespace unchanged through the formatter.

- `attention.diff`: `git show --format= --first-parent -U0 --no-renames b29f3f6 -- lexicons`. The attention prefs snapshot comes from `git show b29f3f6:lexicons/sh/mschf/ratking/attention/prefs.json`. The list snapshots come from that path under `b29f3f6^1` and `b29f3f6`.
- `turn.diff`: `git show --format= -U0 --no-renames de38582 -- lexicons/sh/mschf/agentgraph/turn.json`. Its snapshot comes from `git show de38582:lexicons/sh/mschf/agentgraph/turn.json`.
- `digest.diff`: `git show --format= --first-parent -U0 --no-renames 70b65a9 -- lexicons/sh/mschf/ratking/attention/prefs.json`. Its snapshots come from that path under `70b65a9^1` and `70b65a9`.

The history property checks the hydrated paths only: attention prefs and mailbox list, the turn record, and the optional digest addition. The CLI replay hydrates every changed lexicon from Git.
