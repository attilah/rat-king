# Secret references in Nest state

This packet leaves every existing stack in explicit legacy mode. It does not place credentials, rotate them, deploy a stack or edit live state. The desk owns those actions.

## Declarations and plans

`credentials.ts` owns the fleet's selection. `fleetLegacyRandomCredentials` is currently `true`. The desk's switch commit sets it to `false`. Reference mode reads `s3Credentials.accessKey` and `s3Credentials.secretKey` from the private instance inventory selected by `RATS_NEST_INSTANCE`. Those fields contain secret-store names, never values. Public code has no name defaults. Missing fields fail with `InventoryError` in reference mode; they never fall back to Random. Keep both names in the inventory's `secretNames` publication-fence list as well.

Expected legacy plan against matching existing state:

```text
store/access-key       noop
store/secret-key       noop
store/identity         noop
store/server           noop
celld/environment      noop
celld/node             noop
mailbox-cli-environment noop
```

Expected reference switch with the same pair under those names:

```text
store/access-key       delete (state only; no remote resource)
store/secret-key       delete (state only; no remote resource)
store/identity         update (metadata only; sha256 unchanged)
store/server           noop
celld/environment      update (metadata only; sha256 unchanged)
celld/node             noop
mailbox-cli-environment noop
```

Other unchanged resources remain noop. A fresh reference stack has no Random resources. A second reference plan against matching state is noop. These shapes are fixture expectations, not a claim about a live plan.

Alchemy beta.83's `Apply.ts` noop branch retains `node.state.props`. Merely returning noop for byte-identical files would leave the old inline secrets in state. The file provider therefore plans an update when the content source changes. If both the recorded and live sha match the rendered sha, it marks path, mode and sha256 stable. Reconciliation reads the file back without writing it. Dependent restart digests stay unchanged.

Stop if either file's rendered sha changes at switchover. Stop on remote replacement, unexpected deletion, file writes or unit restarts. Do not change the named values between plan and apply. Stable attributes describe the pair observed during that plan, not a concurrent rotation.

## Desk-run switch

Run this only after the 10:00Z backup and the next ship, not in the same restart. Use the approved instance and external state location. Do not print credential values, dump resource rows or put values in shell arguments or logs.

Before the window, the desk places the existing pair under the two names without rotating it. The stack runner must be able to lease both names. The switch commit changes only the fleet credential selection. Retain the prior code and protected recovery material under the desk's existing custody policy.

1. Plan and apply the `contentFrom` switch. Verify the exact plan shape above and unchanged identity/environment sha256 values before applying. The two Random deletions remove state rows only. The two file updates replace persisted inline props with reference metadata without remote writes. Weed and celld must not restart.
2. Read back celld's S3 access. List through the configured S3 path, then put a small invented body under a fresh scratch key and get it back. Compare exact bytes. Remove the scratch object after the proof. An HTTP health response alone does not prove S3 access.
3. After that proof, remove remaining old serialized values from active state and any obsolete copies covered by the approved cleanup. Do not delete a file resource row to scrub it: retain its path, mode, sha256 and `contentFrom` metadata. The apply should already have removed the two Random rows and rewritten both credential-bearing file props. Backups and historic copies need separate custody review; do not silently destroy recovery material.
4. Search active state for the `__redacted__` marker without printing matched lines. For example, `grep -rl -- '__redacted__' "${APPROVED_STATE_DIR:?}"` lists filenames only. No matches is the expected result for these credential rows. Investigate other matches by resource name without dumping values. Confirm the two Random row names are absent and repeat the reference plan; it must be noop.

A failed proof stops cleanup. Do not recover by simply enabling legacy Random mode again: absent Random rows could mint a different pair. Restore the known pair and reference declarations under the desk's recovery procedure. No rollback or cleanup is authorized by this document alone.

## Recovery

Reference mode finds the pair through `agent-secrets` on the stack runner, using the two names in private inventory. It does not recover credentials from Random state rows. Restore access to those named values before planning state recovery. Keep `RAT_KING_RECOVER_STATE` off for an ordinary switch.

`qualifyRecoveryPlan` reads the fleet selection. Reference recovery admits no plain Random creates. Existing remote resources must pass the normal deferred adoption checks. Deletes and replacements still fail recovery qualification. Legacy mode retains the existing allowance for the two Random creates; it is not the reference-mode recovery path.

## Planned rotation, unused in this packet

Rotation is a separate approved maintenance window after switchover. Replace the pair under the same two names in `agent-secrets` through the approved secret-store procedure. Never put the new values in declarations or templates. Freeze those names for the plan/apply interval.

The identity and celld environment retain their names and paths. Their rendered sha values change, so both files plan updates. The identity sha feeds weed's `restartOn`; the environment sha feeds celld's `restartOn`. Existing unit providers and restart/startup gates own the updates. Review their actual plan and service ordering before approval. A two-file update is not an atomic credential rotation, and the interval between service updates can reject requests. Use the planned outage window rather than promising zero downtime.

After apply, repeat the list and scratch put/get proof. Keep prior credentials available through the approved restoration path until verification passes. This mechanism is implemented and covered by fixture tests, but no rotation was run.

## Effect pin follow-up

Effect remains pinned at 4.0.1. A package-only 4.0.5 attempt installed but failed typecheck because the graph contained both versions. The errors included incompatible `SchemaAST` checks and a missing `NodeInspectSymbol` on Effect values. The desk deferred a coordinated upgrade; no compatibility casts or diagnostic relaxations were added.

The root and all sibling Effect consumers remain on 4.0.1. Root and package `@effect/vitest` pins, the workspace `@effect/vitest`, platform-node-shared and SQL overrides, and Alchemy beta.83's peer resolution also remain on 4.0.1. The package-local attempt is retained in the worker's `effect-4.0.5-attempt` Git stash, not in the shipped tree. A coordinated upgrade must align this shared graph and rerun the full gate as its own packet.
