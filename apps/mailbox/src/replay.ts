import { ReplayAuthority } from "@rat-king/mailbox-client";
import { Effect, Layer } from "effect";

import type { Bindings } from "./bindings.ts";
import { failure } from "./failure.ts";

export { ReplayAuthority } from "@rat-king/mailbox-client";

export type { ReplayInterface } from "@rat-king/mailbox-client";

export const replayLayer = (env: Bindings) =>
  Layer.succeed(
    ReplayAuthority,
    ReplayAuthority.of({
      consume: Effect.fn("AuthTokens.consume")(function* consume(claims, now) {
        const accepted = yield* Effect.tryPromise({
          catch: () => failure("MailboxUnavailable", 503),
          // oxlint-disable-next-line typescript/promise-function-async -- Effect adapters require lazy Promise thunks.
          try: () =>
            env.AUTH_TOKENS.getByName(env.SERVICE_DID).consume(
              claims.iss,
              claims.jti,
              claims.exp,
              now
            ),
        });

        if (!accepted) {
          return yield* Effect.fail(
            failure("AuthRequired", 401, "Reused service token")
          );
        }

        return yield* Effect.void;
      }),
    })
  );
