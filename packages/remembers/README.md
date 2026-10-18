# Remembers

Remembers turns session slices into cited work claims. The package runs a complete night against test Layers. It does not enable a schedule, deploy a worker, connect a model, or read a live session store.

## Contracts and ports

`src/contract.ts` exports Schemas for slice keys, claims, verbatim observer drafts, citation references, memory records, defects, delivery identities and run books. A slice key uses string chunk IDs. Citation offsets count Unicode code points, are half-open, and cover at most 280 code points within one chunk.

The ports are `SliceSource`, `Observer`, `Judge`, `CanonSource`, `Store`, `Speaks`, `Recheck` and `PlanSteps`. Their implementations stay under `adapters/`. `Recheck` has a test stub that records the record and its subject vector. It does not schedule a clock deadline.

`PlanSteps` has three jobs:

- `think(delivery, key)` runs an unrecorded observation and its deterministic post-processing. It returns a `SliceResult`, never raw model output or slice text.
- `judge(delivery, candidate)` returns a truth/staleness verdict. A host adapter must resolve evidence within the model step when needed.
- `dedupe(delivery, results)` joins safe slice results into records after the parallel branches finish.

Every delivery carries `runId`, `key`, `visit` and `epoch`. The SQLite store persists write receipts on the complete tuple. A repeated write returns its original count without duplicating observations. The store preserves uses, unions citations and observations, advances subject-vector components monotonically, and never revives an invalid record.

## Observation and night lifecycle

An observation verifies every verbatim quote against its slice and builds SHA-256 citation references. One failed cite drops the whole item. The post step drops secret, customer and personal claims before any durable output. It redacts regex matches, rejects copied transcript spans of 24 code points or more in both decoded string fields and serialized output, and drops a claim only when the always-loaded canon explicitly states it.

Canon matching is conservative normalized text containment, not semantic inference. The runtime manifest must contain only always-loaded canon. A Brain or skill that is not always loaded must not enter that manifest.

The night machine runs through `cursor → slices → pipeline → books → reportOwed → complete`. Any failed stage ends at `alarm`. Branch failures remain in the books and prevent cursor advancement. Concurrency defaults to 16 and can be configured per run. Observer and judge calls share those branch slots. Retry uses exponential jittered backoff for `429`, `503` and `server_is_overloaded`, without a spend cap.

Starting a run creates durable report debt. A successful report clears that debt and advances the cursor. Failure or interruption sends an alarm. `auditOwed(owner)` also checks debt after process recovery; the host must call it during recovery even if no next night starts. Speaks must deduplicate sends by notice ID across crashes.

Records of type `defect` form an append-only history. Each pass gathers IDs, asks `SliceSource.defectCount` for authoritative weekly counts, and sends an encrypted notice when the count reaches 3 or impact equals 3. Fired IDs prevent repeat notices. Each entry contains a literal matching signature and optional role. The observer supplies the root-cause ID and matching signature; sampled observations never supply the count. The contract and routing step enforce defect signatures of 8–23 Unicode code points. A longer observer signature drops that defect item without failing its slice. The source-count service may accept more, but Remembers never sends a longer matcher. Opaque source-side signature IDs are a future contract, not a v0 fallback.

## SQLite cells

`SqlCells` binds one SQLite connection per project and one control connection. `sqliteStore` creates records, FTS5 projections, write receipts, report debt, cursor and fired-defect tables. `nodeCells` is the Node adapter. A worker host supplies a workerd-safe SQL adapter through `SqlCells`; it must provide real transactions.

`sqliteLayer(false)` opens an existing schema without DDL. The CLI also opens SQLite connections read-only. Search checks the requested project first and falls back to other bound projects only when it finds no valid project hits. It ranks policies, product rules, decisions and preferences above other claims. Invalid records stay in SQLite but never appear in current recall.

## Mischief integration

The exact worker dependency is pinned in `package.json`. `adapters/worker.ts` exposes `workerCallables`, `composeWorker`, `observerStep` and `judgeStep`. The callable registry is an array of name/callable entries passed to `planRunWorker({ callables })`.

The observer step uses `remembers-slice` only as an **ephemeral** capability. The `remembers-observed` post capability receives `{ answer, ephemeral }`, converts quotes to references, and returns safe claims. The judge step re-reads evidence ephemerally and uses `remembers-judged` to record only accepted safe candidates. Model calls stay in Mischief think steps, not capability handlers. The builders select `gpt-6.1-sol` at low effort for observation and `gpt-6-astra` for judging. Dedupe and idempotent store capabilities run after the join.

Never expose `remembers-slice` or `remembers-judge-input` as ordinary journaled call steps. Their results intentionally contain raw evidence. The exported step builders place them only in ephemeral positions. Restrict plan submission at the host boundary.

`composeWorker` needs `Store`, `SliceSource` and `CanonSource` Layers. Supply private model prompts to the step builders at runtime. The production `PlanSteps` adapter, cell bindings, scheduling, model routing and deployment composition belong to the host. `MISCHIEF_STEP_KINDS=call` remains off unless the owner separately approves a real run.

The HTTP slice adapter implements `/slice` and `/quote`, bearer authentication, per-role text caps, identity checks and quote-hash verification. Cursor windowing and the full-store literal-count query remain injected jobs, so the package cannot silently substitute sampled counts or invent a source cursor.

## Private runtime configuration

The Node model adapter reads these keys through Effect Config:

| Key | Value |
| --- | --- |
| `REMEMBERS_OBSERVER_PREFIX_PATH` | Path to a nonempty private observer prefix |
| `REMEMBERS_JUDGE_RUBRIC_PATH` | Path to a nonempty private truth/staleness rubric |
| `REMEMBERS_CANON_PATHS` | JSON array of paths to always-loaded canon files only |

It requires `FileSystem` and `Models` Layers. No model prompt or rubric ships in this package. Capability code has no file access.

The Node recall CLI reads:

| Key | Value |
| --- | --- |
| `REMEMBERS_CONTROL_DB` | Existing control database path |
| `REMEMBERS_PROJECT_DBS` | JSON object mapping project names to existing database paths |
| `REMEMBERS_SLICE_URL` | Optional approved local slice-service URL |
| `REMEMBERS_SLICE_BEARER` | Optional bearer credential, read as a redacted config value |

Keep configuration, paths and credentials outside the repository. Nothing in the package supplies deployment inventory or secret-store names.

## Recall

```sh
node packages/remembers/adapters/cli.ts --help
node packages/remembers/adapters/cli.ts search "approval" --project orchid
```

The workspace package also provides the `remembers` bin. Quotes appear only when the configured `SliceSource` resolves them and their hashes match. Otherwise recall returns claims and citation references, with unavailable or stale quote status. Neither search surface injects memories into prompts or logs every hit as a use.

`recallExtension(runtime)` registers the `remembers` Pi search tool and `remembers_use`. The host owns the supplied runtime and disposes it on shutdown. Call `remembers_use` only for a result the agent actually acts on. Its tool-call ID makes use logging idempotent.

## Checks and limits

```sh
pnpm exec vitest run --project remembers
pnpm check
pnpm test
```

Property tests cover the full fixture night, book counts, privacy drops, regex redaction, invalid and split-surrogate cites, astral-prefix offsets, transcript-leak boundaries, canon-only novelty, dedupe reinforcement, full-store defect thresholds, encrypted defect notices, report failure alarms, ranking, project fallback, stale quotes, acted-on uses, runtime private-file loading, concurrency, overload backoff and the shared actor-watch seam. A fast-check command model checks delivery replay, causal advance, monotonic invalidation and use logging against real SQLite after every command.

Untested here: live model extraction quality, a production slice service, production SQL and Speaks adapters, cross-process delivery races, host-wide model quotas, worker recovery on a deployed cell, backfill completeness and consecutive live canary runs. Fixture proofs do not authorize deployment or the first real night.
