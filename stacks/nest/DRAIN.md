# Scheduled intake

`drain` and `ack` use the same host settings and script-identity secret as `send`. They run before stage configuration loads. The name comes from the identity DID, never a name flag. Both commands take its fenced reader lease and release it on exit. A live Pi holding that name makes the command exit 4 immediately, without reading.

```sh
node stacks/nest/cli.ts drain --as rat_king_script_acme-intake_identity --max 100 --wait 0
node stacks/nest/cli.ts ack --as rat_king_script_acme-intake_identity 3mxmfmbk52a6q
node stacks/nest/cli.ts drain --as rat_king_script_acme-intake_identity --exec 'process-intake'
```

`--max` defaults to 100 and accepts 1–10000. `--wait` defaults to 0 and accepts 0–86400 seconds. When empty, the command polls for new mail once a second until the deadline. The lease renews every minute during waiting, output and consumer execution. Shell commands must be trusted local configuration, not message contents.

## Processing and acknowledgement

Plain `drain` prints JSONL and **acks nothing**. Every subsequent drain prints unacked messages again. It scans the complete event-log snapshot from sequence zero, folds receipt transitions, skips acked and expired messages, then applies the batch limit. It writes no durable cursor. A batch limit never hides a later acknowledgement in the event log.

`ack` settles only the listed message IDs in this identity's mailbox. Already acked IDs succeed without another acknowledgement. An unknown ID refuses the request before any IDs are acked. Retrying after a partial transport failure is safe.

`--exec` sends the batch's JSONL to a shell command's stdin while retaining the lease. It waits for both stdin completion and process exit. Only exit 0 allows acknowledgement. Nonzero exit propagates unchanged and acks nothing. A signal or interrupted parent leaves the batch pending; dedupe on replay. Interruption closes the scoped child process. A consumer that exits 0 before taking all its input is not successful processing.

A process failure after consumer success but during acknowledgement can leave a partially acked batch. Consumers must dedupe by `messageId`, including when a side effect succeeded before a crash. Printing or appending a line to a log is not processing. Do not use `--exec 'cat >> file'` to treat a log append as a handled message.

Mischief's `deliverReply` refuses duplicate delivery with `ReplyRefused` and changes nothing. A Mischief consumer should treat a successful delivery **or `ReplyRefused`** as handled and return 0 after the whole batch. Retry only transport or process failures. It must not convert a transport failure into success.

## Wire lines

```json
{
  "messageId": "3mxmfmbk52a6q",
  "replyTo": "3mxmfmbk52a6q",
  "from": "acme/writer",
  "body": "Proceed",
  "acceptedAt": "2026-10-11T00:00:00.000Z",
  "summary": "Reply",
  "did": "did:web:acme.writer.agents.example.invalid",
  "thread": "3mxmfmbk52a6q",
  "cc": [],
  "kind": "reply",
  "verified": true
}
```

`from` exists only when the signature verified and the sender DID resolves through the directory or the DID template. A claimed payload name is never authority. An unverified message omits `from` and sets `verified:false`. It still prints; explicit acknowledgement or a successful consumer may settle it, but the stderr count reports it separately from verified handling.

`replyTo` comes from the opened envelope. It and `thread` are omitted when absent. `cc` defaults to `[]`; `summary` defaults to the empty string. Asks project as `kind:message`. Typed records retain their JSON text in `body`, use `kind:data` and include `$type`.

For an unopenable signed-plaintext message, the untrusted plaintext body is retained for logging. An unopenable encrypted or malformed envelope has an empty body, not invented or decoded ciphertext. The sender DID and message ID still identify the failed verification. A failed peer-directory transport stops the batch with exit 3 rather than disguising an outage as an unverified signature.

**`acceptedAt` is present only when the server supplies it.** The initial admission event or a later receipt event may supply `recordedAt` or `time`. Missing server time is omitted, never replaced with sender time or the drain clock. This pilot exception is approved by the desk; server timestamp emission belongs to the later receipts packet.

The seam fixture pins Mischief `a1d659e12c898a289f2ea54d6b1045310ec93f30`. Its `deliverReplyContract.input` uses `ReplyLineSchema`: `body` and `replyTo` are required; `from`, `messageId`, and `acceptedAt` are optional; extra fields are ignored. Signature trust is enforced by presence of `from`, not by a `verified` field in that pinned schema. The property test imports the vendored JSON schema and decodes serialized drain lines without reshaping. Set `MISCHIEF_CONTRACT_REPO` to a local Mischief checkout to check the fixture against that exact Git object.

## Exit codes

| Code | Meaning | Next step |
| --- | --- | --- |
| 0 | Successful drain, including an empty mailbox, or successful ack. Stderr ends with `{drained,unverified}`. | Process and ack the printed IDs, unless `--exec` already did so. |
| 2 | Usage, missing identity/settings, retired name or authorization refusal. | Correct the flags, provision the identity or repair its configuration before retrying. |
| 3 | Transport, output, consumer stdin or lease-release outcome is uncertain. | Retry and dedupe by message ID. No durable cursor has advanced. |
| 4 | Another reader holds the name. Nothing read. | Stop that reader or wait for lease release before the next scheduled run. |
| Other nonzero | The `--exec` consumer's exit code. | Repair/retry the consumer; no batch IDs were acked. |

The lease release can fail after a consumer succeeded and some acks landed. Exit 3 does not mean no acknowledgement occurred; it means the command cannot confirm its final outcome.

## Provision and schedule

Use a dedicated script identity, not a Pi reader's identity secret. Mirror [script-send provisioning](FLEET-OPS.md#provision-a-script-identity):

```sh
nest.sh provision --agent acme-intake \
  --did did:web:acme.intake.agents.example.invalid \
  --secret rat_king_script_acme-intake_identity
```

The DID must match the configured template for `acme/intake`. Never start a Pi under that name. The desk installs the schedule after landing; this packet does not provision, install or activate anything.

One-minute cron, with private output files and **no print-time ack**:

```cron
* * * * * umask 077; HOME=/home/ops PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /home/ops/rat-king/stacks/nest/cli.ts drain --as rat_king_script_acme-intake_identity --max 100 >> /home/ops/intake.jsonl 2>> /home/ops/intake.log
```

Equivalent launchd job fields (use absolute paths for the installation host):

```xml
<key>Label</key><string>example.acme.intake</string>
<key>ProgramArguments</key><array><string>/usr/local/bin/node</string><string>/home/ops/rat-king/stacks/nest/cli.ts</string><string>drain</string><string>--as</string><string>rat_king_script_acme-intake_identity</string><string>--max</string><string>100</string></array>
<key>StartInterval</key><integer>60</integer>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>/home/ops</string><key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string></dict>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>/home/ops/intake.jsonl</string>
<key>StandardErrorPath</key><string>/home/ops/intake.log</string>
```

These schedules log pending messages repeatedly until a consumer processes and acknowledges them. Run one scheduler for the identity; the mailbox lease fences overlapping launches but is not a substitute for scheduler ownership.
