import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import {
  isPlistText,
  launchdPath,
  plistDigest,
  renderPlist,
} from "../src/launchd-plist.ts";
import { deleteLaunchd, reconcileLaunchd } from "../src/launchd.ts";
import type { LaunchdAttributes } from "../src/launchd.ts";
import { launchdFixture, makeLaunchdFake } from "./launchd-fixtures.ts";

type Action = "alpha" | "beta" | "retain" | "delete";

interface Model {
  value: string | undefined;
}

interface Real {
  readonly fake: Effect.Success<ReturnType<typeof makeLaunchdFake>>;
  output: LaunchdAttributes | undefined;
}

const command = (action: Action): AsyncCommand<Model, Real> => ({
  check: (model) =>
    action === "alpha" || action === "beta" || model.value !== undefined,
  run: Effect.fn("Test.launchd.model")(
    function* run(model: Model, real: Real) {
      if (action === "retain" || action === "delete") {
        if (real.output === undefined) {
          throw new Error("Model lost output.");
        }

        yield* deleteLaunchd(real.fake.shell, {
          ...real.output,
          deleteOnRemove: action === "delete",
        });

        if (action === "delete") {
          model.value = undefined;
          real.output = undefined;
        }
      } else {
        const prior = real.output;

        const mutations = real.fake.calls.filter(
          (call) => call !== "print"
        ).length;

        const props = { ...launchdFixture, environment: { EXAMPLE: action } };
        real.output = yield* reconcileLaunchd(
          real.fake.shell,
          props,
          real.output
        );

        if (model.value === action) {
          expect(real.output.pid).toBe(prior?.pid);
          expect(
            real.fake.calls.filter((call) => call !== "print")
          ).toHaveLength(mutations);
        } else if (model.value !== undefined) {
          expect(real.output.pid).not.toBe(prior?.pid);
          expect(
            real.fake.calls.filter((call) => call !== "print").slice(-2)
          ).toEqual(["bootout", "bootstrap"]);
        }

        expect(real.output.sha256).toBe(plistDigest(props));
        model.value = action;
      }

      const bytes = yield* real.fake.file();
      expect(bytes === undefined).toBe(model.value === undefined);

      if (model.value !== undefined) {
        expect(new TextDecoder().decode(bytes)).toBe(
          renderPlist({
            ...launchdFixture,
            environment: { EXAMPLE: model.value },
          })
        );
      }
    },
    // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests, typescript/promise-function-async -- fast-check owns this Promise boundary.
    (effect) => Effect.runPromise(effect)
  ),
  toString: () => action,
});

it.effect.prop(
  "LaunchAgent model preserves no-op, restart order, PID and retain/delete custody",
  {
    actions: Arbitrary.schema(
      Schema.Array(
        Schema.Literals(["alpha", "beta", "retain", "delete"])
      ).check(Schema.isMaxLength(20))
    ),
  },
  ({ actions }) =>
    Effect.gen(function* model() {
      const fake = yield* makeLaunchdFake();

      const setup = {
        model: { value: undefined } satisfies Model,
        real: { fake, output: undefined } satisfies Real,
      };

      yield* Effect.promise(
        asyncModelRun.bind(undefined, () => setup, actions.map(command))
      );
    })
);

it.effect.prop(
  "unowned files, foreign agents, unreadable state and changed SHA refuse before mutation",
  {
    failure: Arbitrary.schema(
      Schema.Literals([
        "unowned",
        "foreign",
        "unreadable",
        "tampered",
        "protected",
        "apple",
      ])
    ),
  },
  ({ failure }) =>
    Effect.gen(function* refusal() {
      const fake = yield* makeLaunchdFake();
      let output: LaunchdAttributes | undefined;
      let props = launchdFixture;

      if (failure === "tampered") {
        output = yield* reconcileLaunchd(fake.shell, props);
      }

      if (failure === "unowned" || failure === "tampered") {
        yield* fake.shell.write({
          bytes: new TextEncoder().encode("foreign bytes"),
          mode: 0o600,
          path: launchdPath(props),
        });
      } else if (failure === "foreign") {
        fake.foreign();
      } else if (failure === "unreadable") {
        fake.unreadable();
      } else if (failure === "protected" || failure === "apple") {
        props = {
          ...props,
          label:
            failure === "protected"
              ? "com.ratking.fleet-ship"
              : "com.apple.example",
        };
      }

      const mutations = fake.calls.filter((call) => call !== "print").length;
      const before = yield* fake.file();

      const result = yield* Effect.result(
        reconcileLaunchd(fake.shell, props, output)
      );

      expect(result._tag).toBe("Failure");
      expect(fake.calls.filter((call) => call !== "print")).toHaveLength(
        mutations
      );
      expect(yield* fake.file()).toEqual(before);
    })
);

it.effect.prop(
  "plist rendering escapes XML and sorts environment keys",
  {
    value: Arbitrary.schema(Schema.String),
  },
  ({ value }) =>
    Effect.sync(() => {
      const safe = Array.from(value, (character) =>
        isPlistText(character) ? character : ""
      ).join("");

      const text = renderPlist({
        ...launchdFixture,
        environment: { A: "first", Z: "last" },
        programArguments: ["/usr/bin/yes", `${safe}<&"'`],
      });

      expect(text).toContain("&lt;&amp;&quot;&apos;");
      expect(text.indexOf("<key>A</key>")).toBeLessThan(
        text.indexOf("<key>Z</key>")
      );
      expect(text).toContain(
        "<key>ProcessType</key><string>Background</string>"
      );
      expect(text).toContain("<key>Nice</key><integer>10</integer>");
      expect(text).toContain("<key>LowPriorityIO</key><true/>");
    })
);

it.live("restart refuses an unchanged PID", () =>
  Effect.gen(function* samePid() {
    const fake = yield* makeLaunchdFake();
    const output = yield* reconcileLaunchd(fake.shell, launchdFixture);
    fake.stuck();

    const result = yield* Effect.result(
      reconcileLaunchd(
        fake.shell,
        { ...launchdFixture, environment: { EXAMPLE: "changed" } },
        output
      )
    );

    expect(result._tag).toBe("Failure");
  })
);
