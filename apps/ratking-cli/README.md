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
```

Every command takes `--as <name>` (default `RATKING_NAME`) and `--json`.

## Identity

Config is the Pi tool's: `RATKING_CONFIG`, else `~/.config/rat-king/pi.json`, with the name's key in the host secret store. `--as` is accepted only for names whose key this machine holds. `whoami` prints the name, DID, key source and the current lease holder.

## Lease rules

- `send`, `ask` and `reply` sign with the name's key and never take the lease, so a live Pi holding that name is undisturbed.
- `inbox`, `read`, `thread` and `pending` peek. They list and open, and never deliver, ack or take the lease.
- `inbox --hold` alone consumes: it acquires the lease, delivers each unsettled message, acks it after it is shown, and releases. If a live holder exists it refuses `LeaseHeld`, names the holder's session, and takes nothing.

## Output

Human output follows the TUI kit grammar, `🐀 <verb> <party> · <short facts>`, callsign only. `--json` prints one JSON document, `{"command", "ok", ...}`. Errors print the literal prompt (`Tag: why`, `Accepted`, `Fix`, `Debug`), or `{"ok": false, "error": {tag, why, accepted, fix, debug}}` with `--json`.

Exit codes: 0 done, 2 refused, 3 uncertain or partial (a resend can duplicate), 4 `LeaseHeld`.

## Run

`node apps/ratking-cli/bin/ratking.ts <command>`, or the `ratking` bin of this package.
