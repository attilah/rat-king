# Fleet operations

The nest CLI loads its settings from one private JSON file selected by `RAT_KING_STAGE_CONFIG`. Other application settings do not fall back to environment variables. `stage-config.ts` owns the schema; unknown fields are refused. Keep the file and state directory outside this repository.

The JSON contains:

- `runtime`: the named settings declared by `RuntimeConfig`. Arrays and booleans are JSON values, not shell strings. `HOME` and the inventory location are explicit. Publication metadata is explicit; the desk sets the approved commit before cutover. Listener approval, offline planning and recovery remain separate settings.
- `comms` → `local`: absolute locations for sessions, route receipts and quarantine.
- `comms` → `remote`: the same locations plus an SSH target. Both hosts require readable receipts and existing session/quarantine directories.
- Optional `mintHost`: the SSH target, Node executable, DID and secret-store entry name. Omit it when minting is not authorized.

A private launcher only needs to select the JSON and execute `stacks/nest/cli.ts` with its arguments. It no longer exports individual settings.

## Commands

| Command | Behavior |
| --- | --- |
| `health [--previous file]` | Existing read-only host health and stderr summary. |
| `ship` | Fetch main, require its successful publication-fence workflow, and deploy changed commits serially. |
| `ship-plist` | Print the launchd plist using configured paths. Never install or load it. |
| `doctor` | Inspect each configured host’s selected Pi config, issuer executable/script arguments, document files and service-issuer identity lease. Print sanitized fail reasons; exit nonzero on failure. |
| `digest` | Read-only host health plus comms counts. Append one JSON line to the configured state's `health.jsonl` and print that line. Read the last history line for the previous health sample. |
| `done-bar` | Print separate host counts. Exit zero only when raw intercom sends and lost messages are zero on each host over the last 24 hours. |
| `provision` | Forward mailbox provisioning flags. Without `--secret`, substitute the agent label into `RAT_KING_AGENT_SECRET_TEMPLATE`. |
| `mailbox` | Forward any mailbox CLI command and flags under the same configuration. |
| `mint-host` | Generate signing/agreement keys on the configured target. Refuse an existing secret-store entry. Send private keys only through target-local stdin to the secret store. Print only the DID after successful storage. |
| `send` | Send one signed-plaintext message as a send-only script identity. Needs only this host's pi.json and secret store, not the stage config. See [Script sends](#script-sends). |
| `seal` | Resolve recipients and seal signed plaintext without submitting it. Print one JSON journal for durable replay. See [Durable sends](#durable-sends). |
| `send --as <identity-secret> --sealed -` | Submit a sealed journal from stdin without re-sealing. Print one receipt per accepted envelope. |
| `drain`, `ack` | Read or acknowledge script inbox messages. See [DRAIN.md](DRAIN.md). |

The Python collector is a read-only filesystem adapter. It emits frames; the Effect stream parses and classifies them. Call IDs are scoped to each session file. A send/ask/reply/handover whose result contains `Rat King` is network-routed; other returned results count as raw intercom. Calls without a tool result count as unanswered, not raw, and do not affect the done-bar. Digest exposes their aggregate as `unanswered_24h`; older history without that field still parses. Malformed session lines follow the old collector's skip behavior. Invalid route receipts, missing inputs, SSH failures and collector timeouts fail rather than reporting zero.

Digest history keeps the old field meanings: route, fallback, loss and quarantine counts come from the local host; raw intercom counts sum both hosts. The done-bar is deliberately stricter: it also checks remote losses. A failed measurement does not append a successful digest.

## Script sends

Cron jobs and launchd monitors send through a dedicated **send-only identity**, for example `acme/alert-cron`. It is never a desk's name. `send` never claims a name, starts a reader or takes a lease; it leases the identity key for one minute, signs, sends and exits.

```sh
node stacks/nest/cli.ts send --as <identity-secret> --to <project/row> [--cc <name>]... --summary <line> --body <text | ->
```

- `--as` names the identity's secret-store entry. The sender name comes from the identity's DID through the host's DID template (`didTemplate` in pi.json) or its `reserved` table, never from a flag. An identity whose DID maps to no name is refused.
- `--to` and `--cc` resolve like pi-ratking: the local directory first, then the DID template and the mailbox's public document. Aliases in `reserved` apply.
- `--summary` is one line of 1 to 280 characters. `--body -` reads the body from stdin.
- The payload matches pi-ratking's signed plaintext (`from`, `to`, `cc`, `summary`, `thread`, `kind: "message"`), so a Pi renders it as summary, then sender. Recipients verify the sender name against its DID.
- Settings come from `RATKING_CONFIG`, else `$HOME/.config/rat-king/pi.json`: `endpoint`, `serviceDid`, `didTemplate`, `reserved`, `directory` and `secretsCommand`.

| Exit | Meaning | Output |
| --- | --- | --- |
| `0` | Every recipient's mailbox accepted the message. | stdout: one JSON line `{"id","seq","to"}` for the primary recipient. |
| `2` | Refused. Retrying will not help until something changes. | stderr: `NOT DELIVERED: <code>. <reason>`. Codes: `UnknownName`, `Retired` (the reason names the current row when there is a successor), `Unauthorized`, `Self`, `Partial` (names who already accepted; do not resend to them), `NoIdentity`, `NotConfigured`, `Usage`, `NotAttempted`, or the mailbox's own rejection code. |
| `3` | Transport failed or admission is unconfirmed. | stderr: `NOT SENT: <reason>` when nothing reached a mailbox (safe to retry), or `UNCERTAIN: <reason>` when the message may have landed (a resend can duplicate it). Uncertain admission retries the same envelope for about 90 seconds first; the mailbox treats a repeat as the same message. |

### Durable sends

A durable job must save its sealed envelopes before submitting them. Ordinary `send` seals again on each invocation, so invoking it after a crash can deliver a duplicate. Use the split commands instead:

```sh
node stacks/nest/cli.ts seal --as example_job_identity \
  --to acme/inbox --cc acme/watch --body "Job complete" --summary "Job result"

node stacks/nest/cli.ts send --as example_job_identity --sealed - < /private/job/sealed.json
```

`seal` accepts `--body -` for stdin and optional `--summary`, `--thread <tid>` and `--reply-to <tid>`. Summary rules match ordinary `send`. Without a summary, that payload field is absent. Without a thread, the payload thread is the primary envelope's messageId. `--reply-to` marks the payload as a reply and signs the envelope's reply reference to the primary recipient; its sender DID is the resolved primary recipient's DID. `--thread` is independent, so pass the original thread when replying within an existing conversation.

`seal` prints exactly one JSON line, always using the array form even for one recipient:

```json
{
  "messageId": "3mxmfmbk52a6q",
  "envelopes": [
    {
      "to": "acme/inbox",
      "envelope": {
        "aad": {
          "messageId": "3mxmfmbk52a6q",
          "recipientDid": "did:web:acme.inbox.agents.example.invalid",
          "recipientKeyId": "did:web:acme.inbox.agents.example.invalid#encryption",
          "senderDid": "did:web:acme.job.agents.example.invalid"
        },
        "ciphertext": { "$bytes": "<signed-message bytes in base64>" },
        "enc": { "$bytes": "AA==" },
        "suite": { "aeadId": 0, "kdfId": 0, "kemId": 0 },
        "version": 1
      }
    }
  ]
}
```

The example shows the shape, not a submit-ready signature. The actual output contains the complete signed bytes. The top-level `messageId` is the primary envelope's TID and the reply target. Each CC has its own sealed envelope and TID, as in pi-ratking transmit; every copy carries the primary thread and recipient list. No expiry is set. Sealing can read public recipient documents and update the local directory cache, but never writes a network mailbox or acquires a reader lease.

The caller owns the journal: save the complete JSON in private durable storage and confirm persistence before sending. Do not pipe `seal` straight into `send` for a crash-safe job. The journal contains readable signed plaintext, not encrypted private content. Keep it outside the checkout and public logs.

`send --sealed` accepts only `--as` and `--sealed -`. It validates the whole batch before the first submission, including matching every `senderDid` to the leased identity. It needs no name lookup, reader lease or re-sealing. Envelope values and signed bytes are preserved; JSON whitespace and object key order are not part of the server's canonical admission comparison.

| Exit | Meaning | Output / next action |
| --- | --- | --- |
| `0` | All envelopes accepted, including identical replays. | stdout: one `{"id","seq","to"}` line per envelope, with the original receipt on replay. |
| `2` | Terminal refusal, including `UnknownName`, `Retired`, `Expired`, `Unauthorized`, `Self`, invalid journal or missing identity. | stderr: `NOT DELIVERED: <code>. <reason>`. Fix the cause; do not blindly retry. |
| `3` | Transport failed or admission is unconfirmed. | stderr begins `NOT SENT:` or `UNCERTAIN:`. Retry later with the **same saved JSON**, even if some receipts were already printed. |
| `5` | Different canonical bytes under an admitted sender DID and TID. Terminal caller bug. | stderr exactly: `NOT DELIVERED: Conflict (409). Different bytes under an admitted tid; terminal caller bug. Do not re-seal or retry this envelope.` |

Submission stops at the first failure and retains stdout receipts for earlier accepted envelopes. Replaying the whole unchanged journal is safe: earlier recipients return their original receipts. This path makes one attempt per envelope, leaving retry timing to the durable caller. Never regenerate the journal to recover from exit 3.

### Provision a script identity

The operator mints it once, on the operator host, the same way a Pi on that host mints its own name through the command issuer: generate keys into the secret store, then register the public document at the DID the template gives the name. The agent label and secret name must avoid `/` and `.`, so pass the template DID for `<project>.<row>` explicitly:

```sh
nest.sh provision --agent acme-alert-cron \
  --did did:web:acme.alert-cron.agents.example.invalid \
  --secret rat_king_script_acme-alert-cron_identity
```

The printed DID must equal the template applied to `acme.alert-cron`; then recipients see the sender as `acme/alert-cron`. Use a `rat_king_script_` secret name, never the `rat_king_fleet_agent_<project>.<row>_identity` name a Pi would look for. Never start a Pi as that name: it would find no key under its own secret name, mint fresh keys and replace the registered document.

### Run it from cron on another host

The host needs a checkout of this repository, Node, a working pi.json (any host already running pi-ratking has one) and the identity in its own secret store. Copy the key over stdin only; it never touches argv, a file or a log:

```sh
secrets lease rat_king_script_acme-alert-cron_identity --ttl 1m --client-id provision \
  | ssh <cron-host> 'secrets add rat_king_script_acme-alert-cron_identity'
```

Then the cron line, with an absolute Node and a `HOME` so pi.json and the secret store resolve:

```cron
*/5 * * * * HOME=/home/ops PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /home/ops/rat-king/stacks/nest/cli.ts send --as rat_king_script_acme-alert-cron_identity --to acme/acme-desk --summary "disk alarm" --body "disk 91% on worker" >> /home/ops/alert-cron.log 2>&1 || echo "rat king send exit $?" >> /home/ops/alert-cron.log
```

The stage config and operator key never leave the operator host. On the operator host itself, `nest.sh send …` runs the same command.

## Continuous deployment

The optional `ship` config owns the source checkout, private release directory, receipts, checkpoint, polling interval, GitHub repository, bot executable, launchd paths and notification identity/names. `ship-plist` prints a plist; the desk installs it. No job is installed by these commands or by this packet.

The Effect loop drives the pinned XState cycle: idle → fetching → waiting-ci → deploying, with failed holding a failed SHA. Each cycle fetches main. It requires the newest GitHub Actions fence check to pass and verifies that its workflow run belongs to the exact main SHA and the publication-fence workflow. Each candidate gets a detached private clone and frozen dependency install before the existing deploy action runs. The loop never checks out or resets the operator's source tree.

Successful and failed SHAs are checkpointed. A checkpoint is pessimistically written before deployment, so an interrupted attempt cannot silently redeploy the same SHA after process restart. Maintenance-busy and restart-policy exclusions defer the candidate, not fail it. The checkpoint stores its retry deadline. Each poll still fetches main; a newer SHA supersedes the deferred one. An unchanged deferred SHA skips install/deploy until its deadline. Each completed attempt records start/end epoch seconds, result, whether celld restarted, and restart duration. Failed commands retain `stderrTail`: a bounded projection of public causes, provider frames and error codes. Raw stderr, paths, schema inputs and unrecognized text are withheld rather than written to receipts. Uncertain restart outcomes remain null rather than being reported as no restart. One loop runs one deployment at a time; the desk owns the single launchd job and coordination with manual deploys.

Restarting deploys include celld changes and storage-unit changes that cascade through Requires. `ship.restart.minIntervalHours` defaults to 6. Optional `window` uses `startHourUTC` inclusive and `endHourUTC` exclusive; it can wrap midnight. Equal endpoints allow all hours. `noticeSeconds` defaults to 60. Allowed restarting candidates send one signed plaintext pre-notice to the configured recipients, wait that delay, then recheck policy and maintenance. A failed pre-notice defers the restart. In-place mailbox swaps skip the restart policy and notice.

Worker/config files stage before service lifecycle commands. The ship preflight stages both celld and storage declarations before any service control, then the existing unit reconcile reloads systemd before restart. A changed existing declaration must match its qualified prior owner hash; foreign drift and identity replacements are refused. Interrupted creation of the two mailbox staging files can transfer ownership from the prior persisted Deployment only when exact path, prior content hash, mode 600 and private inventory-owned parents match. Other files and foreign drift retain the matching-file adoption refusal. Helper script hashes are readiness dependencies, not process restart inputs. Process input or unit declaration changes can restart the process; helper readiness changes cannot. Old helper-inclusive fingerprints project onto those same process inputs without forcing a migration restart. Operator bundles use the entrypoint directory as esbuild working directory, so candidate clone paths do not change bytes.

The actual target/dependency start or restart rechecks maintenance under the backup lock. Marker timestamps are epoch seconds at the control boundary, not deployment start. Receipts measure the target systemd ActiveExit-to-ActiveEnter monotonic interval, including drain and dependency startup. InvocationID distinguishes an actual transition from an idempotent start. Uncertain outcomes remain null. The existing post-start listener gates remain. Celld also runs an ExecStartPre gate that waits up to 30 seconds for an authenticated S3 bucket HEAD to return 200. Start order alone is not readiness. Dependency-cascade starts are coalesced only if InvocationID changed, the staged declaration is loaded, and Linux process readback proves the running binary, command arguments and environment match the desired inputs. Unproven matches keep the explicit restart rather than suppressing a necessary change. A real storage restart may still include storage startup time; the desk must verify its full downtime before enabling the loop.

Notifications use the existing mailbox contract, in-memory identity leases and signed plaintext payloads so the operator feed can read them. The payload contains only deployment SHA/result and restart facts, never keys or private configuration. Names, sender identity secret and directory come from private config. Optional `ship.notify.config` selects Pi config; otherwise the existing Pi settings port uses configured HOME. The notifier reuses Pi Directory resolution, including reserved names/aliases and configured public documents, and resolves all targets before sending. A rejected note logs the candidate SHA, recipient, underlying failure tag and sanitized reason; schema inputs are withheld and key-shaped tokens are redacted. Notification failure never triggers a second deployment. The desk must verify notification identity/name mapping during installation. Existing listener approval must be explicit in JSON before starting the job. Set metadata to the landed commit, print the plist from that checkout, and install only one job.

`stage.json` selects doctor hosts through `doctor.primary` and `doctor.secondary`. Each accepts optional `config` (Pi JSON path) and `node` (Node executable); secondary requires `ssh`. Omitted config paths use that host’s `RATKING_CONFIG`, then `$HOME/.config/rat-king/pi.json`. No instance path lives in code. Issuer arguments that look like paths or script/config filenames are checked without running the issuer. Service issuers lease and validate their configured host identity for one minute without printing it. Missing or unreadable references, absent doctor host configuration, malformed config and unavailable collectors make digest `fail`. Fail reasons use host labels and reference indices, not configuration values.

The desk owns cutover. Code readiness does not authorize deployment, restarting readers, or minting keys. A mint failure after storage may leave an identity present; inspect the target before retrying. There is no automatic key rotation or mint retry.
