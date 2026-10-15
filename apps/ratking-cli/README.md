# ratking

The Rat King command line. It is a client of `@rat-king/ratking-client`, the same core the Pi tool uses.

```
ratking send  --to <name> [--cc <name>]... [--summary <line>] (--body <text|-> | --record <file> --type <nsid>) [--encrypt] [--cc-on-purpose]
ratking ask   --to <name> --body <text|-> [--summary <line>] [--wait --timeout <s>] [--due-by <epoch-ms>]
ratking reply <id> --body <text|-> [--summary <line>] [--only-sender] [--to <asker>]
ratking inbox [--all] [--after <seq>] [--hold]
ratking read <id>
ratking thread <id>
ratking pending
ratking whoami
ratking doctor
ratking attention show [--of <name>]
ratking attention set [--model none|jev] [--body never|summary|full] [--now <0..1>] [--later <0..1>] [--judgment <text>] [--timeout-ms <n>]
ratking attention dnd <90m|2h|1d> [--note <text>]
ratking attention available
ratking attention allow|refuse|forward <name>... [--remove]
ratking attention mute (--thread <ref> | --group <ref>) [--remove]
ratking attention test [--message <id> | --from <name> --kind message|ask|reply|data [--cc] [--thread <ref>] [--group <ref>]]
ratking attention log [on|off]
ratking filter add '<rule-json>'
ratking filter remove <id>
ratking filter list
ratking identity | provision | retire | unretire | retired | traffic
```

Every command takes `--as <name>` (default `RATKING_NAME`) and `--json`.

## Identity

Config is the Pi tool's: `RATKING_CONFIG`, else `~/.config/rat-king/pi.json`, with the name's key in the host secret store. `--as` is accepted only for names whose key this machine holds. `whoami` prints the name, DID, key source and the current lease holder.

## Lease rules

- `send`, `ask` and `reply` sign with the name's key and never take the lease, so a live Pi holding that name is undisturbed.
- `inbox`, `read`, `thread` and `pending` peek. They list and open, and never deliver, ack or take the lease.
- `inbox --hold` alone consumes: it acquires the lease, delivers each unsettled message, acks it after it is shown, and releases. If a live holder exists it refuses `LeaseHeld`, names the holder's session, and takes nothing.

## Attention

`ratking filter add '{"id":"quiet-fleet","match":{"from":"fleet/*"},"route":"quiet"}'` adds or replaces a first-match receiver rule; `remove <id>` deletes it and `list` shows local hits and expiry (`--json` includes full rules). Routes are `wake`, `quiet`, `digest` with `minutes` (1–1440), and `hide`, with optional ISO `until`; filters never change durable delivery, operator mail or direct asks.

Writes read the stored preferences, change one thing and put the whole record back, so model, mutes, lists and probabilities you did not name stay as they were. Probabilities are decimals 0..1 at the shell. `attention test` is read-only: it loads your levers, runs the same `attend` the reader runs and prints the verdict, and calls neither `putPreferences` nor `putStatus`. If levers are switched off (`RATKING_ATTENTION`), it says so and the verdict is the plain intent default. `attention log` only shows and toggles the `log` preference; no outcome store exists yet, so it lists no outcomes.

## Operator commands

`identity`, `provision`, `retire`, `unretire`, `retired` and `traffic` are the `apps/mailbox/cli` commands mounted unchanged. They need the operator `RAT_KING_*` configuration described in `apps/mailbox/cli/README.md` and are not part of ordinary agent use.

## Output

Human output follows the TUI kit grammar, `🐀 <verb> <party> · <short facts>`, callsign only. `--json` prints one JSON document, `{"command", "ok", ...}`. Errors print the literal prompt (`Tag: why`, `Accepted`, `Fix`, `Debug`), or `{"ok": false, "error": {tag, why, accepted, fix, debug}}` with `--json`.

Exit codes: 0 done, 2 refused, 3 uncertain or partial (a resend can duplicate), 4 `LeaseHeld`.

## Run

`node apps/ratking-cli/bin/ratking.ts <command>`, or the `ratking` bin of this package.
