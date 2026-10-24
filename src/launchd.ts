import { Effect, Schedule, Schema } from "effect";
import { transition } from "xstate";

import { absent } from "./absent.ts";
import { AbsolutePath, readFile, refuse } from "./files.ts";
import { HostError, must } from "./host-shell.ts";
import type { Interface } from "./host-shell.ts";
import { launchdLifecycle } from "./launchd-lifecycle.ts";
import {
  allowedLabel,
  isPlistText,
  launchdPath,
  launchdTarget,
  LaunchdSchema,
  plistDigest,
  renderPlist,
} from "./launchd-plist.ts";
import type { LaunchdProps } from "./launchd-plist.ts";

export interface LaunchdAttributes {
  readonly label: string;
  readonly labelPrefix: string;
  readonly uid: number;
  readonly path: string;
  readonly sha256: string;
  readonly pid: number;
  readonly deleteOnRemove: boolean;
}

export const validateLaunchd = Effect.fn("Launchd.validate")(function* validate(
  props: LaunchdProps
) {
  const valid = yield* Schema.decodeEffect(LaunchdSchema)(props).pipe(
    Effect.mapError(
      () =>
        new HostError({
          operation: "validate",
          reason: "Invalid LaunchAgent properties.",
        })
    )
  );

  if (
    !allowedLabel(valid.label, valid.labelPrefix) ||
    !Schema.is(AbsolutePath)(valid.programArguments[0]) ||
    !isPlistText(valid.directory + valid.workingDirectory)
  ) {
    return yield* refuse("Protected label or invalid LaunchAgent path.");
  }

  return valid;
});

export const readLaunchd = Effect.fn("Launchd.read")(function* read(
  shell: Interface,
  props: LaunchdProps
) {
  yield* validateLaunchd(props);
  yield* must(shell, ["/bin/launchctl", "print", `gui/${props.uid}`]);

  const result = yield* shell.exec([
    "/bin/launchctl",
    "print",
    launchdTarget(props),
  ]);

  if (result.code === 113) {
    return absent;
  }

  if (result.code !== 0) {
    return yield* refuse("LaunchAgent state is unreadable.");
  }

  const pid = Number(
    /^\s*pid = (?<pid>\d+)\s*$/mu.exec(result.stdout)?.groups?.pid
  );

  const path = /^\s*path = (?<path>[^\r\n]+)$/mu
    .exec(result.stdout)
    ?.groups?.path?.trim();

  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    path !== launchdPath(props) ||
    !/^\s*state = running\s*$/mu.test(result.stdout)
  ) {
    return yield* refuse(
      "LaunchAgent is not a readable running process at its declared path."
    );
  }

  return { pid };
});

export const assertOwnership = Effect.fn("Launchd.assertOwnership")(
  function* assertOwnership(
    shell: Interface,
    props: LaunchdProps,
    output?: LaunchdAttributes
  ) {
    const path = launchdPath(props);
    const file = yield* readFile(shell, path);

    if (output === undefined) {
      if (
        file !== undefined ||
        (yield* readLaunchd(shell, props)) !== undefined
      ) {
        return yield* refuse("Existing LaunchAgent cannot be adopted.");
      }
    } else if (
      output.path !== path ||
      output.label !== props.label ||
      output.labelPrefix !== props.labelPrefix ||
      output.uid !== props.uid ||
      file?.sha256 !== output.sha256 ||
      file.mode !== 0o600
    ) {
      return yield* refuse("LaunchAgent ownership or plist checksum changed.");
    }

    return file;
  }
);

const observationFor = (
  missing: boolean,
  changed: boolean,
  running: boolean
) => {
  if (missing) {
    return "CREATE";
  }

  if (changed) {
    return running ? "CHANGE_RUNNING" : "CHANGE_STOPPED";
  }

  return running ? "MATCH_RUNNING" : "MATCH_STOPPED";
};

export const reconcileLaunchd = Effect.fn("Launchd.reconcile")(
  function* reconcile(
    shell: Interface,
    props: LaunchdProps,
    output?: LaunchdAttributes
  ) {
    yield* validateLaunchd(props);
    const before = yield* assertOwnership(shell, props, output);
    const running = yield* readLaunchd(shell, props);
    const sha256 = plistDigest(props);
    const changed = before?.sha256 !== sha256;

    const observation = observationFor(
      before === undefined,
      changed,
      running !== undefined
    );

    let [state] = transition(
      launchdLifecycle,
      launchdLifecycle.resolveState({ context: {}, value: "inspect" }),
      { type: observation }
    );

    let pid = 0;

    while (!state.matches("ready")) {
      if (state.matches("writeNew") || state.matches("writeChanged")) {
        yield* shell.write({
          bytes: new TextEncoder().encode(renderPlist(props)),
          mode: 0o600,
          path: launchdPath(props),
        });
        const installed = yield* readFile(shell, launchdPath(props));

        if (installed?.sha256 !== sha256 || installed.mode !== 0o600) {
          return yield* refuse(
            "LaunchAgent plist failed atomic write readback."
          );
        }
      } else if (state.matches("bootout")) {
        yield* must(shell, ["/bin/launchctl", "bootout", launchdTarget(props)]);
      } else if (state.matches("bootstrap")) {
        yield* must(shell, [
          "/bin/launchctl",
          "bootstrap",
          `gui/${props.uid}`,
          launchdPath(props),
        ]);
      } else if (state.matches("verify")) {
        const after = yield* readLaunchd(shell, props).pipe(
          Effect.flatMap((value) =>
            value === undefined || (changed && value.pid === running?.pid)
              ? refuse("LaunchAgent start or PID change is unconfirmed.")
              : Effect.succeed(value)
          ),
          Effect.retry(
            Schedule.spaced("100 millis").pipe(Schedule.upTo({ times: 20 }))
          )
        );

        ({ pid } = after);
      } else {
        return yield* refuse("Invalid LaunchAgent lifecycle transition.");
      }

      [state] = transition(launchdLifecycle, state, { type: "DONE" });
    }

    return {
      deleteOnRemove: props.deleteOnRemove === true,
      label: props.label,
      labelPrefix: props.labelPrefix,
      path: launchdPath(props),
      pid,
      sha256,
      uid: props.uid,
    } satisfies LaunchdAttributes;
  }
);

export const deleteLaunchd = Effect.fn("Launchd.delete")(function* remove(
  shell: Interface,
  output: LaunchdAttributes
) {
  if (!output.deleteOnRemove) {
    return yield* Effect.void;
  }

  if (
    !allowedLabel(output.label, output.labelPrefix) ||
    !output.path.endsWith(`/${output.label}.plist`)
  ) {
    return yield* refuse("Protected or mismatched LaunchAgent deletion.");
  }

  const file = yield* readFile(shell, output.path);

  if (file?.sha256 !== output.sha256 || file.mode !== 0o600) {
    return yield* refuse(
      "Refusing to remove a LaunchAgent with a changed plist."
    );
  }

  const props = {
    directory: output.path.slice(0, output.path.lastIndexOf("/")),
    environment: {},
    label: output.label,
    labelPrefix: output.labelPrefix,
    programArguments: ["/usr/bin/true"],
    uid: output.uid,
    workingDirectory: output.path.slice(0, output.path.lastIndexOf("/")),
  } satisfies LaunchdProps;

  const running = yield* readLaunchd(shell, props);

  if (running !== undefined) {
    yield* must(shell, ["/bin/launchctl", "bootout", launchdTarget(props)]);
  }

  if (
    (yield* readLaunchd(shell, props)) !== undefined ||
    (yield* readFile(shell, output.path))?.sha256 !== output.sha256
  ) {
    return yield* refuse(
      "LaunchAgent deletion failed stop or custody readback."
    );
  }

  yield* shell.remove(output.path);

  return yield* Effect.void;
});
