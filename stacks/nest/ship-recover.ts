import { Effect, Option, Schedule } from "effect";

import type { Interface } from "../../packages/alchemy-nest/src/host-shell.ts";

const storageUnits = [
  "rat-king-seaweedfs.service",
  "rat-king-celld.service",
] as const;

export const recoverStorageUnits = Effect.fn("Ship.recoverStorageUnits")(
  function* recoverStorageUnits(
    shell: Pick<Interface, "exec">,
    healthy: Effect.Effect<boolean>
  ) {
    let down = false;

    for (const unit of storageUnits) {
      const state = (yield* shell.exec([
        "systemctl",
        "--user",
        "show",
        unit,
        "--property=ActiveState",
        "--value",
      ])).stdout.trim();

      down ||= state === "inactive" || state === "failed";
    }

    if (!down) {
      return "running" as const;
    }

    yield* shell.exec(["systemctl", "--user", "reset-failed", ...storageUnits]);

    const started = yield* shell.exec([
      "systemctl",
      "--user",
      "--no-block",
      "start",
      ...storageUnits,
    ]);

    if (started.code !== 0) {
      return "failed" as const;
    }

    const ready = yield* healthy.pipe(
      Effect.repeat({
        schedule: Schedule.spaced("5 seconds"),
        until: (ok) => ok,
      }),
      Effect.timeoutOption("4 minutes")
    );

    return Option.isSome(ready) ? ("recovered" as const) : ("failed" as const);
  }
);
