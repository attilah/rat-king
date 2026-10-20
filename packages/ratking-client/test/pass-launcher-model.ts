import { createServer } from "node:net";

import { Effect, FileSystem, Function as Fn } from "effect";
import { asyncModelRun } from "fast-check";

import { passFailure } from "../src/pass-registry.ts";

export const plantDeadSocket = (path: string) =>
  Effect.gen(function* staleSocketFixture() {
    const fs = yield* FileSystem.FileSystem;
    const server = createServer();

    const listen = Effect.callback<null, ReturnType<typeof passFailure>>(
      (resume) => {
        server.once("error", () => {
          resume(Effect.fail(passFailure("stale socket fixture failed")));
        });
        server.listen(path, () => {
          resume(Effect.succeed(null));
        });
      }
    );

    const close = Effect.callback<null>((resume) => {
      server.close(() => {
        resume(Effect.succeed(null));
      });
    });

    yield* Effect.acquireUseRelease(
      listen,
      () =>
        fs
          .chmod(path, 0o600)
          .pipe(Effect.andThen(fs.rename(path, `${path}.dead`))),
      () => close
    );
    yield* fs.rename(`${path}.dead`, path);
  });

export const runEffectModel = <M extends Record<string, unknown>, R, E>(
  setup: () => { readonly model: M; readonly real: R },
  commands: readonly {
    readonly check: (model: Readonly<M>) => boolean;
    readonly run: (model: M, real: R) => Effect.Effect<void, E>;
    readonly toString: () => string;
  }[]
) =>
  Effect.gen(function* modelBoundary() {
    const context = yield* Effect.context();

    const adapted = commands.map((command) => ({
      ...command,
      run: Fn.flow(command.run, Effect.runPromiseWith(context)),
    }));

    const execute = asyncModelRun<M, R, false, M>;
    yield* Effect.promise(execute.bind(null, setup, adapted));
  });
