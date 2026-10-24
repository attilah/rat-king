# Isolated Darwin instances

`DarwinInstance` declares a local celld, its SeaweedFS bucket and an authenticated transcript slice service. It uses `alchemy-nest` rather than a sibling package because it shares the host port, secret-reference files and S3 signing code. It does not change the Linux providers or register Darwin providers in the Linux provider layer.

All examples below use invented values. Keep real inventory, labels, paths, secret names and Alchemy state in the private inventory repository.

## Resource API

```ts
Darwin.LaunchdService("node", {
  directory: "/srv/example/agents",
  environment: { CELLD_OTEL: "0", OTEL_SDK_DISABLED: "true" },
  label: "org.example.archive.node",
  labelPrefix: "org.example.archive",
  programArguments: ["/srv/example/bin/celld", "--listen", "127.0.0.1:31000"],
  uid: 501,
  workingDirectory: "/srv/example/archive",
});
```

Required fields are `directory`, `environment`, `label`, `labelPrefix`, `programArguments`, `uid` and `workingDirectory`. `deleteOnRemove` defaults to false. Attributes contain the label, prefix, UID, plist path, SHA256, confirmed PID and delete policy.

A label must belong to `labelPrefix + "."`. Empty prefixes and the `com.apple`, `com.ratking` and `homebrew` namespaces are forbidden, including descendants. The protected-label list also refuses the existing fleet ship agent. An existing plist or loaded label cannot be adopted, even when its bytes match. Identity changes require a new resource.

The local adapter requires a non-root Darwin user, canonical paths, regular owner-held files and non-writable-by-others parent directories. It rejects symlinks, including dangling links. Atomic writes use a same-filesystem temporary file, fsync and rename. Identical bytes leave the plist untouched. A changed running service follows the XState lifecycle `write → bootout → bootstrap → verify`; a fresh service follows `write → bootstrap → verify`. Every start reads `launchctl print` back. A restart must change the PID. An unreadable GUI domain or service state refuses.

All plists use `ProcessType=Background`, `Nice=10`, `LowPriorityIO=true`, `RunAtLoad=true` and `KeepAlive=true`. They contain paths, non-secret configuration and configuration digests, not resolved credentials. A tiny Node launcher reads a mode-0600 JSON environment and uses `execve`, so celld replaces the launcher without an extra supervisor or shell evaluation. It forces telemetry off and clears inherited fleet settings by constructing a fresh environment.

Deletion retains by default. Explicit deletion checks the recorded plist SHA and mode before bootout, confirms absence, rechecks the SHA, then removes the plist. It never removes data. If a write/start fails halfway through, do not adopt or reset state to retry: preserve the plist and state for desk reconciliation.

## Instance and private inventory

`DarwinInstance(id, props)` needs:

- `uid`, `root`, `launchAgents`, `labelPrefix`, `bucket`;
- `binaries.node`, `binaries.celld`, `binaries.weed`, `binaries.environmentLauncher`, `binaries.sliceService`;
- `credentials.accessKey`, `credentials.secretKey`, `credentials.sliceToken`: **secret names**, not values;
- `sessionsDatabase`: the existing database's canonical absolute path;
- `countLookbackDays`: required, 1–3650 days. Use 30 unless the owner chooses otherwise;
- eleven distinct unprivileged `ports`: `public`, `internal`, `slice`, `master`, `masterGrpc`, `volume`, `volumeGrpc`, `filer`, `filerGrpc`, `s3`, `s3Grpc`.

There are no host, secret-name or port defaults. Put all secret names in the private publication fence too. The slice token must contain at least 32 characters and no control characters. Provision all three secrets through the existing secret service.

Use `darwinProviders()` with `darwinLocalShell`, `SecretSource.layer` and `NodeServices.layer`. Construct the providers **after** supplying `SecretSource`; the file provider captures that service at construction. The instance uses `contentFrom` for its S3 identity, celld environment and slice token. No resolved values enter resource props or attributes.

The declaration returns `store`, `bucket`, `node`, `slice`, `endpoint` and `sliceEndpoint`. It marks the whole graph retained, including credential files and data directories, so removing a stack cannot strand a running retained agent without its files. Retention drops Alchemy tracking on destroy; it is not a shutdown command. Do not destroy the stack as a rollback procedure.

The public declaration does not select a state store or a working directory. The private stack must use its own name, stage and local state directory. Start its runner **from the private instance directory before importing Alchemy**: Alchemy anchors local state to its initial working directory. Never run this stack from the public checkout or reuse another instance's state.

## Why SeaweedFS

The inspected `celld dev` source has a persisted SQLite object store, `--no-watch`, a loopback listener and inherited-fleet-environment cleanup. That can serve local development without S3. This instance needs fleet replication, epochs and backup semantics, so it uses the regular celld path and SeaweedFS instead.

SeaweedFS matches the fleet and avoids a second storage implementation. The render targets SeaweedFS **4.48**. Its `server.go` declares WebDAV, SFTP, standalone IAM and MQ disabled by default and propagates `ip.bind` to the enabled components. The declaration also disables them explicitly, disables embedded IAM, and sets every enabled HTTP/gRPC port. Public filer/volume listeners, S3 HTTPS, Iceberg, Lance, metrics and debug listeners are off. S3 has an explicit loopback bind too. The data directories use mode 0700. Owned `filer.toml` selects a local leveldb2 metadata directory. Empty owned master, security and notification TOMLs stop discovery of user/system configurations for those components. Their digests participate in store startup ordering and restart decisions. The bucket provider retains the bucket and refuses versioning drift or adoption.

Source: [SeaweedFS 4.48 server flags and bind propagation](https://github.com/seaweedfs/seaweedfs/blob/4.48/weed/command/server.go).

`darwin-pins.ts` records the downloaded archive sizes, SHA256 values and unpacked member SHA256 values for SeaweedFS 4.48 and celld v0.6.1. Both downloaded members identify as Mach-O arm64. These are separate pins; the Linux pins stay unchanged. Native execution still needs qualification on Darwin.

## Slice contract

The service binds only loopback. It opens a `file:` URL with `mode=ro`, passes `readOnly: true`, disables extension loading, and sets `query_only=ON` and `trusted_schema=OFF`. It never uses FTS, changes the schema or offers a write route. Bearer authentication happens before body parsing. Responses use `Cache-Control: no-store`.

| Route | Result |
| --- | --- |
| `GET /slice?conversation=<id>&first=<chunk_id>&last=<chunk_id>` | `{chunks, conversation, first, last, sha256}`. Chunks span all runs in the conversation, ordered by `(started_at, chunk_idx, chunk_id)`; the ID breaks ties. Bounds are inclusive. Missing, foreign or reversed bounds return 404. |
| `GET /quote?chunk=<id>&start=<n>&end=<n>` | `{chunk, end, sha256, start, text}`. Unicode code-point offsets, half-open, at most 280 points. Invalid offsets return 400. |
| `GET /chunks?after=<rowid>&limit=<n>&idle_ms=<n>` | `{items, next}`; at most 2000 metadata rows, no text. Stops before the first row whose conversation is not idle, even if later rows are idle. |
| `POST /count` with `{signature:{literal, role?, since_ms}}` | `{by_day:[{conversations, day}], conversations}`. Case-sensitive literal substring of 8–200 code points. Counts each conversation once, on its earliest matching UTC day. |

The slice digest covers UTF-8 canonical JSON of `chunks`, with each chunk's keys in the order `chunk_id`, `role`, `started_at`, `text`. The quote digest covers the selected text's UTF-8 bytes. Quote offsets are not UTF-16 indexes or grapheme clusters.

A conversation is idle only when its newest chunk is strictly older than `idle_ms`. `next` is the last returned rowid, or the input cursor when blocked. Nothing advances beyond an active conversation.

Count rejects `since_ms` before the rolling configured lookback and names the floor in its 400 response. One count runs at a time; excess requests return 429 before spawning. A nice-incremented Node child reads its parameters on stdin, opens the database read-only and returns Schema-decoded counts on stdout. A 10-second deadline closes its scope with SIGKILL, not cooperative JavaScript cancellation. stderr is drained, not logged. Count input is capped at 8 KiB. Every successful response is capped at 256 KiB; oversized results return 413, never truncated text. Other methods return 405; other GET routes return 404. Missing or wrong bearer tokens return 401.

The runtime requires `SLICE_DATABASE`, `SLICE_TOKEN_FILE`, `SLICE_PORT` and `SLICE_COUNT_LOOKBACK_DAYS`. The instance supplies them from private configuration. No permissive lookback default exists in the service.

## Build and ship gate

Build the two portable Node entrypoints in an empty artifact directory. Set `BUILD_DIR` to an absolute path:

```sh
pnpm -C packages/alchemy-nest exec esbuild src/darwin-exec.ts \
  src/slice-main.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --outdir="$BUILD_DIR" --out-extension:.js=.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'
```

At the owner's explicit install gate:

1. Verify the host is Darwin arm64, Node is at least 24.18, Python 3 is available for the existing S3 signer, and the current user's GUI domain is readable. Inspect every listener before assigning the eleven private ports.
2. Verify both archive and member hashes against `darwin-pins.ts`. Install the binaries and both `.mjs` artifacts in the private instance's versioned artifact directory. Check native versions without starting services. Do not replace another instance's binaries.
3. Create the private inventory using the keys above. Prepare only this instance's canonical parent directory and LaunchAgents directory, with the current user as owner. The instance creates its own 0700 root and data directories. Existing files require desk reconciliation, not adoption.
4. In the private repository, declare a separately named `Stack` with `localState()` and `DarwinInstance`. Supply the Darwin providers, local shell, Node services and secret source. Keep the runner's cwd and state under that private instance directory. Review a plan that adds only this instance's three agents, directories, secret-reference files and bucket. No destroy, replacement or fleet resource is acceptable.
5. Run the native qualification below from the public checkout. It touches a unique throwaway label only. If it refuses cleanup, preserve its evidence for the desk rather than broadening deletion authority.
6. Only after the desk approves the exact plan, deploy from the private instance directory with Alchemy telemetry disabled. Read back all three labels, their paths and PIDs. Inspect all listeners again: every new listener must be loopback and declared. Confirm unauthenticated HTTP returns 401, a fixture request returns a correct digest, the database is still read-only, and a second plan is a no-op.
7. Keep the private state and exact artifact versions for recovery. A failed rollout stops here. The desk may restore the prior artifact paths through a reviewed plan; it must not destroy the bucket, erase data or touch another label.

```sh
RATS_NEST_LAUNCHD_LIVE=1 ALCHEMY_TELEMETRY_DISABLED=1 \
  pnpm exec vitest run --config packages/alchemy-nest/vitest.config.ts \
  packages/alchemy-nest/test/launchd-live.test.ts
```

The live test requires Darwin **and** that explicit flag. Linux skips it. Fixture tests cover the graph's retained resources and secret-free state/plists, lifecycle models, refusal guards, loopback port rendering, Unicode slices, idle cursors, literal counts, concurrency refusal and an actual SQLite subprocess killed at its deadline. Native LaunchAgent behavior, native binaries and live Seaweed listener/readback behavior remain ship-gate checks.
