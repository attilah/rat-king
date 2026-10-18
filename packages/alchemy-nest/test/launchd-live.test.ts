import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { expect } from "vitest";

import { darwinLocalShell } from "../src/darwin-local.ts";
import { readFile } from "../src/files.ts";
import { HostShell } from "../src/host-shell.ts";
import { launchdPath, plistDigest } from "../src/launchd-plist.ts";
import type { LaunchdProps } from "../src/launchd-plist.ts";
import { deleteLaunchd, reconcileLaunchd } from "../src/launchd.ts";

const live =
  process.platform === "darwin" && process.env.RATS_NEST_LAUNCHD_LIVE === "1"
    ? it.live
    : it.live.skip;

live("qualifies a throwaway LaunchAgent on the current GUI domain only", () =>
  Effect.gen(function* qualify() {
    const fs = yield* FileSystem.FileSystem;

    const directory = yield* fs.makeTempDirectory({
      prefix: "launchd-qualification-",
    });

    const root = yield* fs.realPath(directory);
    const uid = process.getuid?.();

    if (uid === undefined) {
      throw new Error("No GUI user UID.");
    }

    let props: LaunchdProps = {
      directory: root,
      environment: {},
      label: `org.example.qualification-${root.slice(root.lastIndexOf("/") + 1).replaceAll(/[^a-zA-Z0-9-]/gu, "")}`,
      labelPrefix: "org.example",
      programArguments: ["/bin/sleep", "3600"],
      uid,
      workingDirectory: root,
    };

    const shell = yield* HostShell;
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* cleanup() {
        const file = yield* readFile(shell, launchdPath(props));

        if (file !== undefined) {
          yield* deleteLaunchd(shell, {
            deleteOnRemove: true,
            label: props.label,
            labelPrefix: props.labelPrefix,
            path: file.path,
            pid: 0,
            sha256: plistDigest(props),
            uid,
          });
        }

        yield* fs.remove(root, { recursive: true });
      }).pipe(Effect.orDie)
    );
    const first = yield* reconcileLaunchd(shell, props);
    const original = yield* fs.stat(first.path);
    const same = yield* reconcileLaunchd(shell, props, first);
    expect(same.pid).toBe(first.pid);
    expect((yield* fs.stat(first.path)).mtime).toEqual(original.mtime);
    yield* deleteLaunchd(shell, same);
    expect(yield* fs.exists(same.path)).toBe(true);
    props = {
      ...props,
      deleteOnRemove: true,
      programArguments: ["/bin/sleep", "3601"],
    };
    const updated = yield* reconcileLaunchd(shell, props, same);
    expect(updated.pid).not.toBe(first.pid);
    yield* deleteLaunchd(shell, updated);
    expect(yield* fs.exists(updated.path)).toBe(false);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      darwinLocalShell.pipe(Layer.provideMerge(NodeServices.layer))
    )
  )
);
