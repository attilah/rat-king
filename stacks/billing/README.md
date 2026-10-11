# Billing ingress: code-ready, not deployed

This stack declares one Worker with one SQLite Durable Object queue, one rate-limit binding, two `secret_text` bindings and one hostname from an input. It does not expose the private mailbox. A single local relay pulls the alerts and sends encrypted envelopes through Rat King.

No Cloudflare credentials, provider calls, deploys, routes or secrets were created for this packet.

## Public contract

| Request | Required header | Result |
| --- | --- | --- |
| `POST /` | `cf-webhook-auth: <webhook secret>` | 200 after durable insert; 401 for missing/wrong secret; 429 when throttled; 413 above 65,536 bytes; 400 for invalid JSON |
| `GET /pull` | `Authorization: Bearer <pull token>` | 200 JSON array, at most 20 alerts; 401 without the token |
| `POST /ack` | `Authorization: Bearer <pull token>` | 200 for `{ "ids": [...] }`, at most 20 SHA-256 ids; 400 for invalid input; 401 without the token |

A known path with the wrong method returns 405 and `Allow`. Other paths return 404. Storage or binding failure returns 503. The hard queue capacity also returns 503 rather than accepting an alert it cannot retain. Pull responses set `Cache-Control: no-store`.

Auth runs before obtaining a DO stub. Accepted ingress requests then use Alchemy beta.81's `Cloudflare.Workers.RateLimit` binding: 10 requests per 60 seconds on one fixed key. Rate limiting is per-colo and best effort, not a global spend guarantee. The SQL queue separately caps retained ids at 1,000. A Worker invocation still costs work even when refused.

The secret comparison hashes both inputs with SHA-256 and compares fixed-size buffers with native `node:crypto` `timingSafeEqual`, supplied by `nodejs_compat`. This checks possession of Cloudflare's shared secret in `cf-webhook-auth`. It does **not** verify an HMAC, a payload signature, a timestamp or Cloudflare's identity independently.

Current Cloudflare documentation was not fetched: this packet forbids network access. Before deploy, the desk must review [Cloudflare webhook destinations](https://developers.cloudflare.com/notifications/get-started/configure-webhooks/) and verify the header, body shape, available notification ids and retry behavior. That review remains open; this code does not claim fresh documentation verification.

## Queue and relay durability

The ingress hashes the first nonempty top-level `alert_id`, `notification_id` or `id`, with a namespace prefix. Without an id, it hashes the original body bytes. Replays within seven days do not overwrite the stored alert or refresh its expiration. Ack deletes the billing payload and retains only the id/time tombstone until expiry. Every insert, pull and ack sweeps expired rows inside its SQL transaction. No access means no sweep, but the 1,000-row ceiling remains; expired alerts are never returned on the next access.

`nest billing-relay` processes one batch per invocation. It runs as the script identity secret `RAT_KING_BILLING_IDENTITY` (default `rat_king_script_billing-alerts_identity`, provisioned as `billing/alerts`), addressed to `RAT_KING_BILLING_RECIPIENT` (default `switchboard`). It emits `billing: <name> <numeric fields>` as a bounded single-line summary and pretty-printed JSON bounded to 24,000 characters as the message body.

The sequence is seal encrypted → fsync journal → submit the same envelope → fsync sent marker → ack. Submission uses `nest send --as billing/alerts --encrypt --sealed -`. Exit 0 permits ack. Exit 3 leaves the same envelope for the next timer. Exit 2 is logged and never acked; other nonzero exits also retain the journal. A crash after send but before the sent marker replays identical bytes and message id into Rat King's existing admission dedupe, rather than generating a new envelope. A crash after the marker retries only ack.

The journal directory is external and mode 700; files are mode 600. Atomic rename and file/directory fsync precede send and ack. Journals older than ingress retention plus one day are pruned on successful passes. Treat that directory as private billing data: it contains the original JSON and encrypted envelope.

**One writer:** install one launchd job. launchd serializes that job's invocations. Do not run a manual relay while it is active, or install a second job using the same journal. There is no persistent process lock to strand recovery after a hard crash. Concurrent independent writers are not qualified.

`nest send` and `nest seal` now accept `--encrypt`. A recipient without the expected agreement key returns exit 2 with `NoAgreementKey`; there is no plaintext fallback. `send --sealed --encrypt` rejects a plaintext envelope. Existing callers without the flag retain their previous behavior.

## Offline plan

Inputs:

- `ALCHEMY_TELEMETRY_DISABLED=1` is required for every stack action.
- `RAT_KING_STATE_DIR` is an external directory, including its real symlink target.
- `RAT_KING_BILLING_HOSTNAME` is a validated hostname supplied by the operator.
- `RAT_KING_BILLING_OFFLINE_PLAN` defaults to `true`.
- `RAT_KING_BILLING_DEPLOY_APPROVED=true` is required for network-enabled planning, deploy or destroy. It records separate authorization; it does not grant it.
- Live inputs `BILLING_WEBHOOK_CREDENTIAL` and `BILLING_PULL_CREDENTIAL` use `Config.Redacted` and Worker `secret_text`, never vars. Offline planning replaces them in memory with non-secret placeholders and prints only names and `[REDACTED]`.

```sh
state=$(mktemp -d)
ALCHEMY_TELEMETRY_DISABLED=1 \
RAT_KING_STATE_DIR="$state" \
RAT_KING_BILLING_HOSTNAME=billing.example.invalid \
node stacks/billing/cli.ts plan
```

The CLI accepts `plan`, `deploy`, `destroy-plan`, `destroy`. Offline mode refuses deploy/destroy. Normal plans refuse delete/replace. Offline mode requires an empty state directory and installs a rejecting HTTP transport. Its provider explicitly reports the Worker absent. **The stock Alchemy planner computes a hypothetical fresh-account create plan, not an observed base-versus-head diff.** The DO, secrets and rate limit are Worker bindings, not extra independently managed cloud resources. The hostname is a Worker custom-domain property.

Before a separately approved deploy, the desk must use real external state and obtain a network-read plan. Tin-Tin reviews that observed plan for only the new Worker, queue, hostname, rate limit and secrets, with no delete or replace. This offline plan cannot prove live names are unoccupied.

## Desk prerequisites and timer

Joel and the desk must supply, outside this repository:

1. Independent random `BILLING_WEBHOOK_CREDENTIAL` and `BILLING_PULL_CREDENTIAL` values in agent-secrets. Lease them into the deployment process as the two secret inputs. Only the pull token reaches the relay.
2. The chosen hostname on the approved zone, supplied through `RAT_KING_BILLING_HOSTNAME`. Do not use the invented example hostname live.
3. A Cloudflare billing notification and webhook destination at `https://<hostname>/`, configured with the webhook secret.
4. A registered Rat King script identity stored as `billing/alerts`, and an enabled recipient with an agreement key.
5. A private runner that leases the pull token into `BILLING_PULL_CREDENTIAL`, sets `RAT_KING_BILLING_URL=https://<hostname>`, `RAT_KING_BILLING_JOURNAL_DIR=<external private directory>` and optionally `RAT_KING_BILLING_RECIPIENT`, then executes `node <checkout>/stacks/nest/cli.ts billing-relay`. Keep the lease and all private paths out of the plist and Git.
6. One launchd unit rendered from `billing-relay.plist.example`. Replace the invented runner/log paths in a private copy. Install it only in the separately authorized live phase.

No deploy is authorized by this packet. Rollback is to disable the notification destination and unload the relay, preserving queue/journal data for investigation. Worker/DO deletion is a separate destructive action requiring an inspected destroy plan and approval.

## Evidence and limits

Six new property/model claims cover the binding-level HTTP gates, SQL replay/ack/expiry, body-hash fallback, relay crash/refusal/retry behavior, actual encrypted sealing/no-key refusal and stock offline Alchemy planning. The SQL model uses real offline SQLite. The relay model drives fast-check commands and counts admitted envelope ids after every command.

Mutation proof: disabling ingress auth makes the HTTP property fail. Acking a refused send makes the relay model fail. Both mutations were restored before the final checks.

Not qualified: Cloudflare's live rate-limit behavior, deployed workerd runtime, live DNS/certificates/migrations, a live billing payload, journal filesystem crash behavior, concurrent manual relay processes, transport integration between the CLI child and a live mailbox, launchd installation, delivery/receipt behavior in production, or the hard queue-capacity boundary as a dedicated property.

After deploy approval, prove one Cloudflare test notification arrives once, an unauthenticated POST returns 401 without a DO invocation, and a replayed notification id delivers once. Code, deployment and live behavior are separate gates.
