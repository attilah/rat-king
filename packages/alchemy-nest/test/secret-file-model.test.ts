import { it } from "@effect/vitest";
import { encodeState } from "alchemy/State/StateEncoding";
import { Arbitrary, Effect, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { makeFakeShell } from "../src/fake-shell.ts";
import { textDigest } from "../src/files.ts";
import type { FileAttributes } from "../src/files.ts";
import { reconcileFile } from "../src/remote-file.ts";
import { SecretSource } from "../src/secret-source.ts";

interface Model {
  installed: string | undefined;
}

interface Real {
  readonly fake: Effect.Success<ReturnType<typeof makeFakeShell>>;
  output: FileAttributes | undefined;
}

const declaration = {
  contentFrom: { secret: "example-model" },
  mode: 0o600,
  path: "/home/example/.config/rat-king/model-token",
};

const command = (value: string): AsyncCommand<Model, Real> => ({
  check: () => true,
  run: Effect.fn("Test.secretFile.model.apply")(
    function* run(model: Model, real: Real) {
      const installed = yield* reconcileFile(
        real.fake.shell,
        declaration,
        real.output,
        false
      ).pipe(
        Effect.provide(SecretSource.fromRecord({ "example-model": value }))
      );

      model.installed = value;
      real.output = installed;
      expect(installed.sha256).toBe(textDigest(model.installed));
      expect(installed.mode).toBe(0o600);
      const bytes = yield* real.fake.shell.read(declaration.path);
      expect(bytes).toEqual(new TextEncoder().encode(model.installed));
      expect(
        JSON.stringify(encodeState({ attr: installed, props: declaration }))
      ).not.toContain(JSON.stringify(value).slice(1, -1));
    },
    // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests, typescript/promise-function-async -- fast-check asyncModelRun owns this Promise boundary, as in quiet-copy-display-model.test.ts.
    (effect) => Effect.runPromise(effect)
  ),
  toString: () => "RotateAndApply",
});

it.effect.prop(
  "repeated secret rotations preserve bytes, permissions and state secrecy",
  {
    sequence: Arbitrary.schema(
      Schema.Array(Schema.NonEmptyString).check(Schema.isMaxLength(15))
    ),
  },
  ({ sequence }) =>
    Effect.gen(function* lifecycle() {
      const fake = yield* makeFakeShell();

      const setup = {
        model: { installed: undefined } satisfies Model,
        real: { fake, output: undefined } satisfies Real,
      };

      yield* Effect.promise(
        asyncModelRun.bind(
          undefined,
          () => setup,
          sequence.map((value) => command(`fixture-value:${value}`))
        )
      );
    })
);
