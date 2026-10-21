// @effect-diagnostics asyncFunction:off -- Pi's session_start handler is the Promise boundary under test.
import { Deferred, Effect, Exit } from "effect";

import type { SessionStart } from "../src/extension.ts";

export const startSession = async (
  handler: (start: SessionStart) => Promise<void>,
  start: SessionStart
) => {
  const started = Deferred.makeUnsafe<boolean>();

  await handler({
    ...start,
    onStarted: () => {
      start.onStarted?.();
      Deferred.doneUnsafe(started, Exit.succeed(true));
    },
  });

  await Effect.runPromise(Deferred.await(started));
};
