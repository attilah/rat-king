# Remembers host

This package binds the Remembers night to a Node supervisor and a dedicated celld Mischief worker. It does not deploy itself, enable a live schedule, call a model, or send mail during installation or tests.

## Ownership

The supervisor owns private prompt files, scheduling, SQLite and report delivery. The worker owns model execution and ephemeral evidence reads. The night machine stays in `@rat-king/remembers`.

The supervisor cannot read a slice or quote. Its `SliceSource.read` and `quote` jobs fail closed. It reads metadata from `/chunks` and authoritative defect counts from `/count`. Only the worker binds `/slice` and `/quote`.

Both submission boundaries accept one fixed plan shape. Observation uses `observerStep`, `gpt-6.1-sol` and low effort. Judging uses `judgeStep` and `gpt-6-astra`. Both use Mischief's Codex gateway. The envelope allows only those models. A shared semaphore limits each supervisor to 16 in-flight jobs. The night also uses 16 branch slots.

`remembers-slice` and `remembers-judge-input` are accepted only as ephemeral inputs with their matching safe post capabilities. The worker refuses ordinary call steps, plan revisions, new states, nested branches and alternate post capabilities. The supervisor strictly decodes each returned `SliceResult` before it can enter the night. It never logs response bodies, prompts or raw model answers.

## One declaration

Add `RemembersHost` to the existing private Alchemy declaration. Pass the existing `DarwinInstance` result as `node`; do not recreate the instance under a new resource ID.

```ts
const declaration = Effect.gen(function* declare() {
  const node = yield* DarwinInstance(existingInstanceId, inventory);
  const worker = yield* buildWorker(workerEntrypoint, version, commit);

  return yield* RemembersHost("remembers", {
    deploymentEnvironment: deployEnvironmentReference,
    hostEntrypoint,
    hostEnvironment: hostEnvironmentReference,
    instance: inventory,
    node,
    worker,
    workerBindings: workerBindingsReference,
    workerUrl,
  });
});
```

Use the existing Darwin providers plus `Celld.DeploymentProvider()`. `buildWorker` uses the existing bundle/configuration builder. `RemembersHost` uses `Celld.Deployment` unchanged, against the instance's node and internal listener. The deploy CLI gets a separate mode-0600 POSIX environment file through `deploymentEnvironment`. The provider sources that file with `sh`; it must not receive the Darwin daemon's JSON environment file. It declares four Mischief SQLite Durable Object classes and restricts the private binding allowlist to `workerPrivateKeys`. The configuration includes a binding-file revision digest, so private binding or canon rotation changes the existing provider's deployment fingerprint without changing that provider.

The new supervisor is a `Darwin.LaunchdService` named `<labelPrefix>.host`. It uses the instance's environment launcher. Its plist contains environment-file references and digests, not resolved credentials. The existing launcher gives it Background process type, nice 10 and low-priority I/O. The supervisor also sets its own nice value to 10.

The retained `HostDirectory` is `<instance root>/remembers`, mode 0700. The root is a positional argument from the declaration, not a configurable database path. The supervisor refuses a redirected data directory or database symlink. It opens one control database and one SHA-256-named database per project, uses WAL and FULL synchronous mode, and supplies real transactions through the existing Node SQLite adapter. Main database files use mode 0600. No project can supply an alternate database path.

`MISCHIEF_STEP_KINDS=call` is a var on this worker deployment only. The production gateway mode is private configuration under `MISCHIEF_MODEL`. Neither is a supervisor, instance-node or fleet-wide environment change.

## Private configuration

The supervisor environment is a private JSON object of string values, supplied through the declaration's `hostEnvironment` secret reference.

| Key | Value |
| --- | --- |
| `REMEMBERS_OBSERVER_PREFIX_PATH` | Nonempty private observer prefix file |
| `REMEMBERS_JUDGE_RUBRIC_PATH` | Nonempty private judge rubric file |
| `REMEMBERS_CANON_PATHS` | JSON array of always-loaded canon file paths |
| `REMEMBERS_PROJECTS` | Nonempty JSON array of unique project names, not paths |
| `REMEMBERS_OWNER` | Notice recipient name |
| `REMEMBERS_MAILBOX_CONFIG_PATH` | Mode-0600 mailbox configuration file |
| `REMEMBERS_WORKER_URL` | Dedicated worker endpoint |
| `REMEMBERS_WORKER_DID` | Worker service identity for signed service-auth tokens |
| `REMEMBERS_SLICE_URL` | Approved slice endpoint |
| `REMEMBERS_SLICE_BEARER` | Slice bearer credential, read as a redacted Config value |
| `REMEMBERS_MODE` | `nightly` by default, or `canary`, `catch-up` or `off` |
| `REMEMBERS_LOAD_THRESHOLD` | Positive finite load threshold, default 40 |
| `REMEMBERS_IDLE_MS` | Positive idle interval, default 1200000 |
| `REMEMBERS_EPOCH` | Nonnegative delivery/retry generation, default 0 |
| `REMEMBERS_CANARY_KEY` | Required in canary mode: JSON `{conversation, first_chunk, last_chunk}` |
| `REMEMBERS_FROM_DAY` | Required in catch-up mode: inclusive UTC `YYYY-MM-DD` |
| `REMEMBERS_THROUGH_DAY` | Required in catch-up mode: inclusive UTC `YYYY-MM-DD`, before today |

The mailbox file follows the existing client Schemas: `identity`, `endpoint`, `serviceDid`, trusted `peers` documents, and `names: { from, peers }`. `names.peers` maps recipient DIDs to names. The owner and defect recipients must resolve in that trusted mapping. The worker must allow the supervisor identity in its caller documents. This creates a send-only client, not another mailbox reader or gateway loop.

`deploymentEnvironment` is a private reference to a complete POSIX environment file for the celld deploy CLI. It supplies the deployment store's `CELLD_BUCKET`, `CELLD_TEST_DATA_DIR`, `S3_ENDPOINT`, `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as shell-safe assignments. Use the same store configuration as the instance. This is separate from the supervisor's JSON `hostEnvironment` and the worker's JSON `workerBindings`.

Keep all files, identities, endpoints, credentials and secret-reference names outside this repository. No prompt or rubric ships here.

### Worker bindings from the same canon files

Create a private input file, mode 0600, containing five string keys: `MISCHIEF_DID`, `MISCHIEF_CALLERS`, `MISCHIEF_MODEL`, `MISCHIEF_CLIPROXY_URL` and `MISCHIEF_CLIPROXY_KEY`. Select the pinned worker's production Codex gateway mode in that private input. With the supervisor configuration available, run the offline materializer:

```sh
node packages/remembers-host/src/bindings-main.ts "$INSTANCE_ROOT" "$PRIVATE_WORKER_INPUT" "$NEW_PRIVATE_BINDINGS"
```

The target must not exist. The materializer writes mode 0600 and prints no values. It derives `REMEMBERS_CANON_JSON` from `REMEMBERS_CANON_PATHS` and copies the approved slice URL and bearer into the worker bindings. Supply this resulting JSON through the private `workerBindings` reference. Regenerate it when always-loaded canon changes. Model prefixes and rubrics stay on the supervisor and enter plans only at runtime.

## Scheduling and recovery

Only one supervisor may run against an instance. Change its mode through the owning declaration; do not start a second catch-up process beside the service.

Every startup audits report debt. Nightly mode processes the previous UTC day once. It checks durable completion before starting. Catch-up takes an inclusive range of at most 366 days and runs the same night machine sequentially. Completed days are skipped, including after a crash between cursor commit and process exit. Failed branches leave report debt and do not advance the cursor.

Admission blocks new nights and new model/branch starts from 09:50 through 10:40Z, with 10:40 allowed. It also blocks at or above the load threshold. It checks again each minute. Calls already in flight drain normally, and their safe results may be stored. It does not cancel remote model calls. Pause and resume logs contain only the admission reason.

Cursor windowing follows the source's idle prefix and never skips its first active conversation. It validates monotonic row IDs and `next`, stops before metadata at the day boundary, and joins metadata windows by conversation. Catch-up uses one fixed lower date bound across its entire range. Nightly mode includes older pending metadata, so a conversation that becomes idle later is not silently dropped because its original day ended.

The completion record and cursor share the night store's transaction. `REMEMBERS_EPOCH` stays fixed for crash replay. After repairing a terminal failed worker plan, the owner can increment it to create new model deliveries and new report IDs. Any successful generation still counts as a completed day. Do not increment it merely to retry an uncertain send.

Speaks persists the sealed, encrypted envelope under the notice ID before sending. Recovery reuses the exact envelope and message ID. The mailbox's existing canonical-envelope deduplication returns the original receipt. Acknowledged notices do not send again. Reusing a notice ID with different content fails closed.

Canary mode runs the configured slice through the same model, judge, store and report path without changing the source cursor. Reports contain books, cite-failure counts and up to ten claims with record IDs and citation references. A canary run ID distinguishes its proof. No proof contains transcript chunks or quote text. Successful canary and catch-up modes then wait idle under launchd's KeepAlive until the owner changes the mode.

Recheck requests are retained as safe pending jobs in the control database. This package does not implement an Awakes deadline scheduler.

## Qualification and rollout

```sh
pnpm exec vitest run --project remembers-host
pnpm check
pnpm test
```

Tests cover safe-only submission and returned-result boundaries, metadata paging, full-store defect counts, a three-day fake-Mischief/fake-slice night against real SQLite, failed branches, completed-day replay, citation-bearing reports, a test-clock load/window pause, in-flight draining across 09:50, crash/lost-ack notice replay, WAL transaction rollback and an offline worker bundle. The slice package adds old-query equivalence and a generated-store timing property.

The owner installs the private declaration, runs the canary, checks its books and citation sample, then runs catch-up and switches to nightly. Fixture checks do not prove live extraction quality, a deployed worker, provider compatibility or gold-set agreement.

To stop new work, set `REMEMBERS_MODE=off` through the owning declaration. Off mode audits report debt, then waits without starting a night or model call. Rollback restores the previous worker bundle/configuration and supervisor entrypoint. Keep the data directory and databases. Removing retained Alchemy resources does not stop their processes or erase their data. Code rollback does not undo memory writes.

Follow-ups: move storage into celld cells behind a job-shaped Store RPC; back up the supervisor's SQLite files, which are not replicated; connect the pending recheck jobs to the owning Awakes scheduler. None is implemented by this packet.
