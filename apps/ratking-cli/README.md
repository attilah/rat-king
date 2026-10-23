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
ratking health <name> [--as operator]
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
ratking snapshot --out <new-directory>
```

Client commands take `--as <name>` (default `RATKING_NAME`) and `--json`. `health` defaults its signer to `operator`, not the inspected name.

## Identity

Config is the Pi tool's: `RATKING_CONFIG`, else `~/.config/rat-king/pi.json`, with the name's key in the host secret store. `--as` is accepted only for names whose key this machine holds. `whoami` prints the name, DID, key source and the current lease holder.

## Lease rules

- `send`, `ask` and `reply` sign with the name's key and never take the lease, so a live Pi holding that name is undisturbed.
- `inbox`, `read`, `thread` and `pending` peek. They list and open, and never deliver, ack or take the lease.
- `inbox --hold` alone consumes: it acquires the lease, delivers each unsettled message, acks it after it is shown, and releases. If a live holder exists it refuses `LeaseHeld`, names the holder's session, and takes nothing.

## Health

`ratking health <name>` reads one name's operator-only `mailbox.nameHealth` projection. It shows the lease holder, generation and expiry, the local reader heartbeat when it matches that lease, the last ack, the oldest delivered wake's id, sender and age, and the count of delivered-but-unacked quiet copies. It reads local Herdr pane status only when a matching local heartbeat establishes locality. It shows a visible current-session turn record when one exists; encrypted or absent records remain unknown. The verdict is `ok`, `reader stuck`, `agent not taking turns`, or `unknown (why)`.

A delivered wake becomes overdue strictly after 180 seconds while its lease is live. Reader progress uses the existing five-minute threshold. Quiet copies do not trigger the wake verdict. Unknown or incomplete observations never claim health. Human output uses the owned TUI primitives in twelve bounded lines; JSON retains full identifiers and facts. The command does not attach, mint identities, take or renew leases, deliver, ack, change preferences, send mail, or restart processes. No restart option is provided.

Senders declare per-recipient `woke` and `wakeReason` at admission, outside the encrypted envelope. `ask` wakes its recipients; ordinary CC, explicit quiet mail and data records do not. The health projection reads those declarations without decrypting content. Legacy signed plaintext payloads can supply missing intent. Legacy encrypted delivered mail without intent remains incomplete, and the quiet-copy count is then a lower bound. The projection returns metadata only, never envelopes, ciphertext, summaries or bodies. A missing operator key or refused projection produces an unknown screen.

Health reads have a ten-second deadline. The server examines at most 10,000 delivered receipts per name and marks larger snapshots incomplete. It reads at most 128 legacy envelopes for plaintext intent fallback; messages with declared intent need no envelope read. Visible turn lookup scans at most 100 traffic pages, with a ten-second deadline. Normal turn records are encrypted to their owners and therefore remain unknown to the operator; a sender-declared turn-status metadata field is a follow-on, not permission to lease owner keys.

## Attention

`ratking filter add '{"id":"quiet-fleet","match":{"from":"fleet/*"},"route":"quiet"}'` adds or replaces a first-match receiver rule; `remove <id>` deletes it and `list` shows local hits and expiry (`--json` includes full rules). Routes are `wake`, `quiet`, `digest` with `minutes` (1–1440), and `hide`, with optional ISO `until`; filters never change durable delivery, operator mail or direct asks.

Writes read the stored preferences, change one thing and put the whole record back, so model, mutes, lists and probabilities you did not name stay as they were. Probabilities are decimals 0..1 at the shell. `attention test` is read-only: it loads your levers, runs the same `attend` the reader runs and prints the verdict, and calls neither `putPreferences` nor `putStatus`. If levers are switched off (`RATKING_ATTENTION`), it says so and the verdict is the plain intent default. `attention log` only shows and toggles the `log` preference; no outcome store exists yet, so it lists no outcomes.

## Operator commands

`identity`, `provision`, `retire`, `unretire`, `retired` and `traffic` are the `apps/mailbox/cli` commands mounted unchanged. They need the operator `RAT_KING_*` configuration described in `apps/mailbox/cli/README.md` and are not part of ordinary agent use.

### Complete issuer snapshots

`ratking snapshot --out <new-directory>` exports the issuer's complete live and retired name lists for callers sync. It uses the existing signed transport and leases the credential named by `RAT_KING_OPERATOR_IDENTITY` from agent-secrets. Configure `RAT_KING_ENDPOINT`, `RAT_KING_SERVICE_DID` and `RAT_KING_ISSUER_LABEL` alongside that secret name. The label is the issuer's placement label, not its URL or DID. The command never prints the credential.

Run from the repository root with that operator environment loaded:

```sh
node apps/ratking-cli/bin/ratking.ts snapshot --out "$HOME/ratking-snapshot-$(date -u +%Y%m%dT%H%M%SZ)"
```

The output parent must exist and be writable. The output directory must not exist. Every page of both contracts must succeed before any snapshot file is written. There is no page cap. A repeated cursor produces `RepeatedCursor` rather than an incomplete snapshot.

The command stages `names.json`, `retired.json` and `issuers.json` beside the destination, then publishes the directory with one rename. Files use mode `0600`; the directory uses `0700`. The two list files share a fresh `snapshot` run id, `complete: true` and exact `total` values. Neither contains a remaining cursor. `issuers.json` maps live names to the configured placement label. Collection rejects conflicting documents for the same name; identical duplicates retain the first configured placement.

Success prints one JSON receipt containing `snapshot`, `totals`, per-issuer `pages` and file `sha256` hashes. Failure prints a JSON diagnostic on stderr with `error`, `failed`, `why` and `next`, exits nonzero and does not publish a bundle. Existing output stays unchanged. Use a new output directory when retrying an `OutputExists` error. These exports are complete traversals, not an issuer-wide transactional read: names can change while pages are fetched.

## Output

Human output follows the TUI kit grammar, `🐀 <verb> <party> · <short facts>`, callsign only. `--json` prints one JSON document, `{"command", "ok", ...}`. Errors print the literal prompt (`Tag: why`, `Accepted`, `Fix`, `Debug`), or `{"ok": false, "error": {tag, why, accepted, fix, debug}}` with `--json`.

Exit codes: 0 done, 2 refused, 3 uncertain or partial (a resend can duplicate), 4 `LeaseHeld`.

## Run

`node apps/ratking-cli/bin/ratking.ts <command>`, or the `ratking` bin of this package.
