import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { makeFakeShell } from "../src/fake-shell.ts";
import type { Interface } from "../src/host-shell.ts";
import { sliceUnit } from "../src/service-units.ts";
import { reconcileUnit } from "../src/systemd.ts";
import type { UnitProps } from "../src/systemd.ts";

const home = "/home/example";

const service = (command: string): UnitProps => ({
  home,
  name: "rat-king-example.service",
  scope: "user",
  sections: [
    { lines: [["ExecStart", command]], name: "Service" },
    { lines: [["WantedBy", "default.target"]], name: "Install" },
  ],
});

const lifecycle = (argv: readonly string[]) =>
  argv[0] === "systemctl" &&
  argv.some((arg) => ["restart", "start", "stop"].includes(arg));

it.effect(
  "a changed slice is written and reloaded, never restarted, so its services keep running",
  () =>
    Effect.gen(function* sliceReload() {
      const fake = yield* makeFakeShell();

      const before = yield* reconcileUnit(
        fake.shell,
        sliceUnit(home, "4G", "200%"),
        undefined,
        false
      );

      yield* fake.clear();

      const after = yield* reconcileUnit(
        fake.shell,
        sliceUnit(home, "8G", "200%"),
        before,
        false
      );

      const calls = (yield* fake.calls()).map((call) => call.argv);

      expect(after.active).toBe(true);
      expect(calls).toContainEqual(["systemctl", "--user", "daemon-reload"]);
      expect(calls.filter(lifecycle)).toEqual([]);
    })
);

it.live(
  "a changed service still activating is restarted only after its start settles",
  () =>
    Effect.gen(function* settleFirst() {
      const fake = yield* makeFakeShell();

      const before = yield* reconcileUnit(
        fake.shell,
        service("/opt/example/one"),
        undefined,
        false
      );

      yield* fake.clear();

      let activating = 2;
      const states: string[] = [];

      const shell: Interface = {
        ...fake.shell,
        exec: (argv, diagnostics) =>
          Effect.suspend(() =>
            argv.includes("--property=ActiveState") &&
            argv.includes("--value") &&
            activating > 0
              ? Effect.sync(() => {
                  activating -= 1;
                  states.push("activating");

                  return { code: 0, stdout: "activating\n" };
                })
              : fake.shell.exec(argv, diagnostics).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      if (lifecycle(argv)) {
                        states.push(argv.join(" "));
                      }
                    })
                  )
                )
          ),
      };

      yield* reconcileUnit(shell, service("/opt/example/two"), before, false);

      expect(states).toEqual([
        "activating",
        "activating",
        "systemctl --user restart rat-king-example.service",
      ]);
    })
);
