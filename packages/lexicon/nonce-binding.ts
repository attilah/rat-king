import { Clock, Context, Effect } from "effect";

import { refusal } from "./pass-failure.ts";
import type { TrustFailure } from "./trust-failure.ts";

export interface NonceIdentity {
  readonly run: string;
  readonly workerThumbprint: string;
}

export class NonceBinding extends Context.Service<
  NonceBinding,
  {
    readonly bind: (
      deskDid: string,
      nonce: string,
      identity: NonceIdentity,
      until: number
    ) => Effect.Effect<"new" | "match" | "conflict", TrustFailure>;
  }
>()("ratking/NonceBinding") {}

export const makeMemoryNonceBinding = (
  now = Clock.currentTimeMillis.pipe(Effect.map((ms) => ms / 1000))
) =>
  Effect.sync(() => {
    const bindings = new Map<
      string,
      { readonly identity: NonceIdentity; readonly until: number }
    >();

    return NonceBinding.of({
      bind: Effect.fn("NonceBinding.bind")(
        function* bindNonce(deskDid, nonce, identity, until) {
          const current = yield* now;

          if (
            !Number.isFinite(current) ||
            !Number.isFinite(until) ||
            until < current
          ) {
            return yield* refusal(
              "Nonce refused",
              "binding retention has expired",
              "obtain a fresh pass"
            );
          }

          const key = JSON.stringify([deskDid, nonce]);
          const prior = bindings.get(key);

          if (
            prior !== undefined &&
            prior.until >= current &&
            (prior.identity.run !== identity.run ||
              prior.identity.workerThumbprint !== identity.workerThumbprint)
          ) {
            return "conflict" as const;
          }

          bindings.set(key, {
            identity: { ...identity },
            until: Math.max(until, prior?.until ?? until),
          });

          return prior !== undefined && prior.until >= current
            ? ("match" as const)
            : ("new" as const);
        }
      ),
    });
  });
