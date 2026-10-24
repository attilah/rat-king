import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { expect } from "vitest";

import { makeFakeShell } from "../src/fake-shell.ts";
import type { Interface } from "../src/host-shell.ts";
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

const unreadable = [
  { code: 1, stdout: "" },
  { code: 0, stdout: "" },
  { code: 0, stdout: "bogus\n" },
];

for (const reply of unreadable) {
  it.effect(
    `an unreadable active state (${JSON.stringify(reply)}) refuses the restart`,
    () =>
      Effect.gen(function* unreadableState() {
        const fake = yield* makeFakeShell();

        const before = yield* reconcileUnit(
          fake.shell,
          service("/opt/example/one"),
          undefined,
          false
        );

        yield* fake.clear();

        const restarts: string[][] = [];

        const shell: Interface = {
          ...fake.shell,
          exec: (argv, diagnostics) =>
            Effect.suspend(() => {
              if (
                argv.includes("--property=ActiveState") &&
                argv.includes("--value")
              ) {
                return Effect.succeed(reply);
              }

              if (argv.includes("restart")) {
                restarts.push([...argv]);
              }

              return fake.shell.exec(argv, diagnostics);
            }),
        };

        const exit = yield* reconcileUnit(
          shell,
          service("/opt/example/two"),
          before,
          false
        ).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        expect(restarts).toEqual([]);
      })
  );
}
