# @rat-king/pi-ratking

A Pi extension that gives any Pi a Rat King name and messaging. It has no Muster dependency. Load it with `pi -e packages/pi-ratking/src/extension.ts`, or install the package; its `pi` manifest names the extension.

## Configuration

The extension reads `RATKING_CONFIG`, or `~/.config/rat-king/pi.json`. Without a valid file, every action fails with `NOT DELIVERED: NotConfigured` and the reader stays off. Example with invented values:

```json
{
  "endpoint": "https://mailbox.example.invalid",
  "serviceDid": "did:web:mailbox.example.invalid",
  "didTemplate": "did:web:{agent}.pi.example.invalid",
  "documents": ["/path/to/public-documents.json"],
  "issuer": { "command": ["sh", "/path/to/mailbox-cli-wrapper.sh"] },
  "reserved": {
    "switchboard": { "did": "did:web:switchboard.example.invalid" },
    "fleet-owner": {
      "did": "did:web:fleet-owner.example.invalid",
      "aliases": ["servo"]
    }
  },
  "refuse": ["fleet-owner"],
  "toolName": "ratking"
}
```

`state` defaults to `~/.local/state/rat-king/pi`. It holds the name claims, read cursors, locks and `directory.json`, the name → DID and public document directory. `documents` lists files of public DID documents, such as the operator-configured fleet documents. `askTimeoutMs` is retained for configuration compatibility. Asks return immediately by default and have no deadline. A copy, meaning mail whose `to:` names someone else, never wakes the reader: it rides into the next turn as a short entry. `ccDigestMinutes` (for example `{ "drovr": 30 }`, keyed by full name or project, full name first) instead holds a reader's copies and wakes it once per interval with one digest, newest first, and only when any are held. Asks and relayed mail always wake. A name in `refuse` starts no reader and mints nothing: `status` reports it as refused and every send fails with `NOT DELIVERED: Refused`. Use it for names another reader still holds.

Automatic owner turn records default off: set `"turnRecords": true` in `pi.json` or override with `RATKING_TURN_RECORDS=1|0`; operator crash records require `alarm.turnRecords: true` (default off). Upgrade receiving owners first, then enable writers; silent turn/friction receipt is unconditional and agent-initiated friction is not gated.

## Names

`RATKING_NAME`, set by the launcher, wins. Muster sets `<project>/<row>`. Aliases in `reserved` map to their reserved name. Without it, the Pi names itself from its Herdr pane label slug, else `pi-<session id>`. A derived name is never reserved, never another live session's claim and never an existing directory name. Claims are written under a lock.

## Identity and issuer

Keys are P-256 pairs generated on the Pi's host. They are stored in the host secret store (agent-secrets) as `rat_king_fleet_agent_<label>_identity`, passed to `secrets add` on stdin, never in argv or logs. `<label>` is the name with `/` replaced by `.`. Existing secrets are reused and never rotated; their DID wins over the template. Reserved names are never minted; their secret must already exist on the host to read or send as that name. A reserved recipient needs no local secret. Its public document comes from the configured `documents`, the local directory, or a mailbox `getPeerDocument` lookup when neither has it. Aliases resolve to the canonical reserved name and DID.

Registration goes through one service, `Issuer.ensure(name, publicDocument) → did`. `issuer` takes one of two shapes.

`{ "endpoint": "https://mailbox.example.invalid", "host": "<host identity secret>" }` is the service issuer. It leases the host's identity JSON from the host secret store and calls the mailbox's `identity.register` with a service-auth JWT signed by the host key. The operator must first enroll that host (`mailbox enroll-host`). The issuer derives the DID from the name with its own template, so `didTemplate` must match the server's. A refusal (`NameTaken`, `NameReserved`, `Forbidden`) fails provisioning with that code. With this issuer, `list` also pages the issuer's directory and records names that are not yet local, so their documents resolve for sending. Local entries are never replaced.

`{ "command": [...] }` is the command issuer. It writes the public document to a private temporary file, runs `<command> register --did <did> --document <file>` and records the name in the directory. Point it at a mailbox CLI built from this repository; bundles without `register` refuse. The operator key stays with that CLI. A later issuer can replace the layer without changing callers.

## Reader

On `session_start` the extension claims its name, ensures its identity and runs `@rat-king/mailbox-client`'s leased consumer for its DID. Failures retry with exponential backoff capped at 30 seconds and show in `status`; they are never fatal. On `session_shutdown` the runtime is disposed, which releases the lease, so a successor Pi acquires it at once.

Each inbound message is injected as a visible `ratking_message` with sender, body, id and a reply hint naming this tool, except program-to-program data and lexicon records. The transcript renderer defaults to one line with the sender label or name, first body line and message id. CC, reply and unverified markers remain visible. Pi's expand toggle (`ctrl+o`) shows the full message and reply hint. Rendering uses message details; model-facing content is unchanged. The handler checkpoints the event's `seq` before ack, so a restarted reader does not replay acked mail. While the reader holds its lease, sends carry the lease fence, as the mailbox requires.

The payload is `{ from, body, kind?, replyTo?, summary?, label?, to?, cc?, thread? }`. It carries no session id: whoever holds the name's lease reads its mail. A sender name is verified when the directory maps the signed sender DID to it, or when the claimed name derives that DID through the template or reserved table.

A reader with no cursor starts at the mailbox's current head (`throughSeq`), so an identity with history never replays it. A message the server refuses to deliver or ack with `InvalidTransition` (already acked, expired or otherwise settled) is skipped and the cursor moves past it.

A message that cannot be opened (unknown sender, bad signature, undecryptable or malformed envelope) triggers one lookup of the sender's document through the mailbox's `getPeerDocument`, then one more open. If that fails, the reader writes `state/quarantine/<label>/<seq>.json` with metadata only (`seq`, `messageId`, `senderDid`, `reason`, `at`; never the body or ciphertext), skips the message without deliver or ack, and moves the cursor past it. `status` shows the quarantine count and the latest entry.

A decrypted JSON object with a string `$type` that is not a Rat King message payload is delivered on `ratking/record` only, never injected into the model, except a verified desk relay received by its configured EA. Records use the same sender verification, checkpoint and ack path as messages. Other decrypted bodies still follow the raw-text message path.

## Staff relay

Opt in at reader start with this `pi.json` field:

```json
"relay": { "name": "switchboard", "to": "switchboard/ea", "mode": "copy", "fallbackMinutes": 10 }
```

Set the same `relay` field on the desk and EA. Only the reader whose own name equals `relay.name` forwards mail; `relay.to` accepts verified desk relays for model delivery. Other names ignore this config. The desk keeps its identity and key. Staff has its own identity. `copy` injects each text message normally and forwards it asynchronously. A verified message from `relay.to` bypasses forwarding. Data and other lexicon records keep their existing event-only paths.

The forwarded signed record is `{ $type: "sh.mschf.ratking.relay#message", id, from, did, verified, kind, body, replyTo, summary, label, cc, encrypted, ccNames?, to?, thread? }`. Nullable text fields use `null` when absent. `id` is the original message id, not the relay envelope id. The original encryption state controls the relay envelope: plaintext stays plaintext; encrypted stays encrypted. Forwarding uses the same sealed-envelope bounded retry as ordinary sends. Failure logs without dropping the original.

`front` saves originals in `state/relay/<name-label>.json` before mailbox ack and suppresses their injection. Verified staff confirms with `{ $type: "sh.mschf.ratking.relay#handled", id: "<original id>" }`, sent as a record to the desk. A failed forward or expired deadline injects the original with `[staff did not handle]`, even if it previously settled an ask waiter; a restarted Pi no longer has that waiter. A one-second sweep handles deadlines; startup recovers overdue pending mail before consumption. Only a verified staff envelope can settle pending mail. Journal files and their directory are private (0600/0700). Malformed journals fail closed and retry, never reset themselves.

The desk records every original in its thread store before routing, as it does for any inbound mail, so `reply` with `replyTo: <original id>` works from the desk even though front mode never injected it. Reply-all reaches the original sender, `to` and `cc`, never the EA unless the original named it. On start, the desk also seeds its thread store from the front journal, so it can still reply to originals received before a restart.

The desk closes loops itself. When its `reply` to an original is accepted, that original is marked handled. When any accepted `send`, `ask` or `reply` names the sender of a pending original in `to` or `cc`, every pending original from that sender is marked handled. Either way the fallback never injects `[staff did not handle]` for it. A journal write failure here is logged and never fails the send.

### Outbound copies

`"copyOutbound": true` makes the desk copy each of its own `send`, `ask` and `reply` messages to `relay.to`:

```json
"relay": { "name": "switchboard", "to": "switchboard/ea", "mode": "front", "fallbackMinutes": 10, "copyOutbound": true }
```

The copy is `{ $type: "sh.mschf.ratking.relay#outbound", id, to, cc, kind, body, replyTo, summary, thread, encrypted }`, sent as a record after the original is accepted. `id` is the sent message id, `to` and `cc` are its recipients, and `replyTo` and `summary` are `null` when absent. The copy uses the original's encryption state. It runs in the background: a failed copy is logged and never fails or delays the send. A message already addressed or cc'd to `relay.to` is not copied. Relay forwards, handled confirmations and partially delivered sends are not copied. Only the reader named `relay.name` copies.

### EA integration

The EA needs only pi-ratking, not a `ratking/record` consumer. When its own name is `relay.to`, the reader accepts a relay record only from a verified `relay.name`. It projects the original sender, label, verification flag, id, summary and body, remembers that original for replies, and injects a visible turn-starting message. The compact view adds `via switchboard`. The original verification flag is the desk's attestation, not a second original-sender signature. Wrong senders and other records stay on the record-event path and never become model mail.

The reply hint uses the original id and `replyAll: false`, so the EA answers the original sender directly. `reply` links that original id, preserves the thread root, and defaults to the original encryption state. In front mode a successful reply also sends a `sh.mschf.ratking.relay#handled` record to the desk. If the reply was accepted but that confirmation fails, the tool reports partial delivery and tells the EA to retry only `handled`, not the answer.

An outbound copy from the verified desk reaches the EA's model as silent context: a `ratking_message` sent with `triggerTurn: false`, marked `sent by switchboard`, with no reply hint. It is not remembered as a thread, so the EA cannot reply to it, and it never adds the EA to anyone's reply-all. It is not emitted on `ratking/message`.

For work handled without a reply, call `intercom({ action: "handled", replyTo: "<original id>" })` (or the configured tool name). It sends the handled record to the verified desk DID stored with the original, using the original encryption state. It refuses unknown ids, ordinary mail and a changed desk DID. The explicit handled action is also available in copy mode; automatic confirmations run only in front mode. A direct EA reply does not settle an `ask` that names the desk's DID: it arrives as normal mail from the EA. The strict asked-DID waiter rule is unchanged.

Custom producers can still emit `ratking/send` with `{ requestId, to: record.from, body: answer, replyTo: record.id, replyToDid: record.did, thread: record.thread ?? record.id, encrypt: record.encrypted, summary }`. `replyToDid` selects a direct reply-link path without local thread lookup. Ordinary EA replies do not need this bridge.

The routing model covers generated inbound, handled, failed-forward, clock and restart commands. The EA model covers verified-desk admission, wrong sender/receiver rejection, original-field projection, direct reply hints and compact via markers; removing model delivery falsifies it. The recipient-view test also checks a turn-starting EA message, an encrypted original-id reply to the sender, and its automatic handled record. Removing startup recovery falsifies the property on an overdue original. Completed-command restarts are covered. An abrupt crash between Pi injection and its journal checkpoint can replay that injection: Pi has no transactional/idempotent injection port. Terminal journal entries remain to deduplicate recovered originals; journal compaction is not implemented. The accepted policy is at-least-once across abrupt crashes and exactly-once after completed operations: replay is preferable to losing mail. `front` remains a later desk-controlled config change. To disable front routing safely, switch to copy while pending originals recover, then remove the config only after the pending set is empty. Removing the config or reverting the reader before draining pending mail would strand already-acked originals.

## Scheduled drain

`nest drain --as <identity-secret>` prints pending mail as JSONL without acknowledging it. Consumers ack after successful processing. See [drain and ack](../../stacks/nest/DRAIN.md) for lease fencing, batch limits, consumer execution and exit codes.

`acceptedAt` is server admission time, taken from the initial message receipt’s `recordedAt`. It is absent on mail admitted before server commit `3f3430a`. Later receipt transitions record their own time without changing admission time. Drain never substitutes sender time, a later transition time or its own clock.

## Typed agent-graph records

`intercom({ action: "record", to: "acme/desk", type: "sh.mschf.agentgraph.checkin", record, summary? })` validates content before sealing or contacting the mailbox. The supported types are `sh.mschf.agentgraph.checkin`, `sh.mschf.agentgraph.plan` and `sh.mschf.agentgraph.outcome`. Content may omit `$type`; if present it must match `type`. Unknown top-level keys are refused, with the offending key and allowed set. Other decode failures name the failing path. Refusals start with `NOT SENT: InvalidRecord.`

Records travel as `kind: data` with `$type`. Check-in summaries default to `check-in ask: <project> <goal>` for ask and `check-in: <project> <goal>` for fyi, bounded to 280 characters. Plans show verdict and packet count. Outcomes cover work done outside Muster only. Known records appear compactly in Pi and as typed, fenced JSON for the model; unknown types keep their existing event-only path.

Scripts use `nest send --as acme-identity --to acme/desk --record checkin.json --type sh.mschf.agentgraph.checkin`. `--summary` is optional for records. File decoding uses the same validator before identity lookup or network access. Invalid records exit 2.

**Drain never acks. The consumer acks on success and on Mischief `ReplyRefused`.** Since Mischief `7198ad0`, `ReplyRefused` means stale or duplicate, so it is terminal. Retry other processing failures without acking.

The content seam is pinned to Tin-Tin's `prototype/src/checkin.ts` at `53702c1`, Effect 4.0.1. This pin supersedes `f0c5a59`: the source now uses opaque machine identifiers (`^[a-z][a-z0-9-]{0,31}$`) rather than inventory names. `test/fixtures/agentgraph.json` records the full commit, source SHA-256 and unmodified JSON Schema exports produced with `Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" })`. Alignment has no transforms or exclusions. The properties reconstruct those exports and compare generated valid and corrupted cases against independent lexicon codecs, including the invented identifier `host-a`. Update the pin only after agreeing a content change with the source owner.

## Tool

The tool takes pi-intercom's parameters. `send`, `ask`, `reply`, `handled`, `pending`, `list`, `status` and `retire` work. `ask` returns `✓ asked <party> · <id8>` after admission; the turn does not wait for an answer. The reader saves the id, recipient, summary and send time in a private `state/asks/<name-label>.json` journal before admission. A reply whose `replyTo` names the ask and whose signed sender is the asked DID wakes the asker with `woken: reply`. Its model content names the original ask id and quotes its summary. Display acknowledgment closes the pending ask; receipt alone does not. Restarting the reader restores pending asks before mailbox consumption. `pending` lists inbound unanswered asks and outbound open asks separately, including outbound age and deadline.

Set `dueBy` to a Unix timestamp in milliseconds to request one quiet no-reply nudge at the next turn after the deadline. The reader checks deadlines on startup and every minute. The ask remains open for a late answer. There is no deadline by default. Only scripts that need to block should use `wait: true` with `timeoutSeconds` between 1 and 600 (default 600). An explicit wait returns the answer or a `NoReply` error at its bound; timeout leaves the durable ask open. The normal agent workflow uses the async default. Replies to tracked asks and no-reply notices stay with the asker even when it has front relay routing enabled.

Journal writes are atomic and malformed journals fail closed. The mailbox and Pi display are not one transaction: an abrupt crash before admission can leave a pending entry with no accepted envelope, and a crash after checkpointing a nudge but before Pi queues it can lose that notice. Completed operations preserve pending state and suppress repeat nudges across restarts. Closed entries remain in the journal; compaction is not implemented.

`handover`, `cancel`, `cwd` targeting and `openProjectPaneIfMissing` are refused with a clear error. A send the mailbox did not take returns `NOT DELIVERED: <code>`, with no fallback.

## Presence

After the mailbox accepts a `send`, `ask` or `reply`, the reader asks the mailbox's `getPresence` whether anyone holds the primary recipient's lease. When nobody does, the result gains one line: `No reader holding this name since 14 h ago (<time>); the message waits in its mailbox.`, or `No reader has ever held this name; …` for a name nobody has ever read. The mail is still delivered durably. An explicit blocking ask that times out carries the same line in its `NoReply` reason. Presence is cached for 30 s per recipient DID. A failed, malformed or slow lookup (over 2 s) adds no line and never fails or delays the send beyond that bound.

## Retirement

A retired name refuses new mail on the server, so every host gets the same answer: `NOT DELIVERED: Retired. <name> was retired at <time>; current row is <successor>.` Retry is pointless; send to the successor. Replays of mail admitted before the retirement still return their original receipt.

Two ways to retire:

- `intercom({ action: "retire", successor?: "<name>" })` (or the configured tool name) retires this Pi's own name, signed by its own identity, then stops the reader and releases its lease like `ratking/retire`. Later sends from this Pi are refused until the next session start.
- The mailbox CLI retires any name with the fleet operator key (`RAT_KING_OPERATOR_IDENTITY`), from any host whose `RAT_KING_ENDPOINT` reaches the fleet mailbox that serves the Issuer DO. Muster's close and relaunch paths call it, because a closed row's Pi is gone. See the [mailbox CLI](../../apps/mailbox/cli/README.md#name-retirement).

```sh
mailbox retire --name <project>/<row> --successor <project>/<row>-2
mailbox retire --name <project>/<row>
mailbox unretire --name <project>/<row>
mailbox retired
```

The server accepts `retire` and `unretire` from the operator key, the name's own identity or the host that registered it. The CLI signs with the operator key; the in-Pi `retire` action signs as the name itself.

The name's own identity acquiring its lease clears the retirement in the same transaction, so a Pi or Muster restore under the same name just works. A retired reader that keeps renewing does not clear it; only a new acquisition does.

Pi keeps the first tool registered under a name and silently drops later ones. While pi-intercom is loaded, keep the default name `ratking`. After pi-intercom is removed, set `"toolName": "intercom"` or `RATKING_TOOL=intercom`.

## CC and threads

`send` and `ask` accept `cc: ["name", ...]`. The reader resolves all recipients before sending, canonicalizes names, deduplicates names and DIDs, and removes itself from cc. Each recipient gets its own signed envelope containing the identical payload: `to` names the primary recipient, `cc` lists the additional recipients, and `thread` is the first envelope's id for a new conversation. Envelope ids differ; the shared thread root does not. No server, lexicon or signature format changes are involved. Old message decoders drop the new payload fields.

`to` is for whoever must act and wakes them; `cc` is for whoever should know and gets a quiet copy that does not wake (an ask's copies still wake). The receipt lists each recipient's wake level, and each inbound header names its reason: `woken: to|ask|reply`, `quiet: cc` or `held: cc digest`.

A `send`, `ask` or `reply` whose message or summary addresses a cc'd name (`@name` or `@row`, or a line starting `ask for`, `question for` or `asked of you:` with that name) is refused before sealing as `AskAimedAtCc`, with the corrected call; pass `ccOnPurpose: true` when the quiet copy is meant. `ratking/send` events skip this check.

Pending asks match only the primary recipient's signed reply; cc recipients do not close them or settle an explicit waiter. `reply` defaults to reply-all: the received message's sender, `to` and `cc`, minus this reader. `replyAll: false` answers only its sender. The reader stores participant fields and the root in `threads.ts`, including replies that settled an ask. Replies preserve the root and link the specific received envelope with `replyTo`. Older messages without participant fields remain sender-only. The compact header renders `cc: a, b` inside the existing four-line budget; long headers are clipped to the terminal width.

Each envelope retains the existing bounded retry with its own id. If admission fails after another recipient accepted, the tool reports `PARTIAL DELIVERY` with accepted names and ids; it does not pretend nothing was delivered. Unknown recipients fail before any envelope is submitted. A successful result returns the primary receipt. This is not an atomic group send. Thread records remain limited to 200 received messages in this Pi runtime; they are not persisted across restarts.

The reply-all model uses generated thread records and reply policies. Removing self-exclusion falsifies it, including sender-only replies to yourself. The transport property opens both envelopes, verifies identical bodies and the primary-id root, checks encryption and recipient deduplication, and proves unknown-cc preflight sends nothing.

## Events for other extensions

- Emit `ratking/send` with `{ requestId, to, body, kind?, encrypt?, cc? }`, or `{ requestId, replyTo, body, kind?, encrypt?, replyAll? }` to answer a received message. Replace `body` with `record: { $type: string, ... }` to send a JSON lexicon record. Exactly one of `body` or `record` is required. Records are sealed as-is, without the message wrapper, and default to encrypted; `encrypt` overrides encryption per send. Message bodies keep the configured encryption default. `kind` is `message`, `ask` or `data`; `data` is for program-to-program traffic: the recipient gets it on `ratking/message` only, never in the model's context. Records carry their own fields; `kind` adds no wrapper or record field. `replyTo` links the envelope to a received message or record. A trusted relay integration can also supply `to`, `replyToDid` and `replyTo` to send directly to the original sender without a local thread lookup; `replyToDid` without `replyTo` is refused. Optional `thread` preserves the relay's root; `summary` supplies the message summary. A malformed request that still has a `requestId` is answered at once with `not-delivered`. The extension emits `ratking/send:result` with `{ requestId, status: "delivered", id, seq, to, presence? }` or `{ requestId, status: "not-delivered", code, reason }`.
- `ratking/record` carries inbound lexicon records: `{ id, from, did, verified, record, replyTo? }`. It never settles a waiting text ask. A verified relay addressed to the configured EA instead takes the original-message path, with model injection; it is not emitted as a raw record event. A valid Rat King message payload takes the message path even if it also has a `$type`.
- Emit `ratking/status` with `{ requestId }`. `ratking/status:result` answers with `{ requestId, name, did, reader, leaseGeneration?, leaseUntil? }`. `reader` is `live`, `acquiring`, `retired`, `off` or `send-only`. Live readers include their lease generation and expiry. `name` and `did` are null when no identity is available, including after retirement. Provisioning, retries and refusals report `off`; lease acquisition reports `acquiring`.
- `ratking/message` carries every inbound message: `{ id, from, did, verified, body, kind, replyTo, cc, ccNames?, to?, thread?, settled }`. `cc` remains the legacy boolean marker; `ccNames` carries the signed participant list. `settled` is true when the message answered a waiting ask.
- Emit `ratking/retire` with `{ requestId? }` when another session has taken over this Pi's name, for example once a restart handover commits. The reader stops and releases its lease while the Pi stays up, so a lingering old process can't ack mail its successor should read. The extension answers on `ratking/retire:result` with `{ requestId?, status: "retired" }`. Later sends are refused as retired until the next session start. Shutdown also waits up to 2 s for the lease release.

`ratkingExtension({ layer, facts, tool })` builds the extension against a `PiHost` port (events, tool and message registration, session start and end). The default export adapts Pi's `ExtensionAPI` to that port with the production layer; tests drive the same factory with Pi's `createEventBus` and a fake mailbox.

## Limits

- A host without an issuer can use only names with existing secrets and directory entries.
- The issuer directory lists only names registered through it. Names registered with the command issuer are invisible to it.
- A reader that loses its cursor resumes at the head; mail that arrived while it had none is skipped, not read.
- A quarantined message stays unacked on the server; its sender sees no delivery.
- Registered DID documents have no revoke route.
