import { Context, Effect } from "effect";

import { decodeDidKey } from "./did-key.ts";
import { refusal } from "./pass-failure.ts";
import type { TrustFailure } from "./trust-failure.ts";

export interface RunToken {
  readonly exp: number;
  readonly iat: number;
  readonly tokenHash: string;
}

export class RunBinding extends Context.Service<
  RunBinding,
  {
    readonly claim: (
      run: string,
      tokenHash: string,
      workerDid: string,
      now: number
    ) => Effect.Effect<"bound" | "match" | "compromised", TrustFailure>;
    readonly close: (run: string) => Effect.Effect<void, TrustFailure>;
    readonly open: (
      run: string,
      token: RunToken,
      now: number
    ) => Effect.Effect<void, TrustFailure>;
    readonly renew: (
      run: string,
      workerDid: string,
      now: number
    ) => Effect.Effect<"match", TrustFailure>;
  }
>()("ratking/RunBinding") {}

type RunState =
  | { readonly state: "open"; readonly token: RunToken }
  | {
      readonly state: "bound";
      readonly workerDid: string;
      readonly token: RunToken;
    }
  | { readonly state: "closed" }
  | { readonly state: "compromised" };

export const makeMemoryRunBinding = () =>
  Effect.sync(() => {
    const runs = new Map<string, RunState>();

    return RunBinding.of({
      claim: Effect.fn("RunBinding.claim")(
        function* claimRun(run, tokenHash, workerDid, now) {
          yield* decodeDidKey(workerDid);
          const current = runs.get(run);

          if (
            current === undefined ||
            current.state === "closed" ||
            current.state === "compromised"
          ) {
            return yield* refusal(
              "Run refused",
              "run is unknown, closed or compromised",
              "ask the launcher for a new run"
            );
          }

          if (!Number.isFinite(now) || current.token.tokenHash !== tokenHash) {
            return yield* refusal(
              "Run refused",
              "token does not match",
              "use the launcher-issued token"
            );
          }

          if (current.state === "bound") {
            if (current.workerDid === workerDid) {
              return "match" as const;
            }

            runs.set(run, { state: "compromised" });

            return "compromised" as const;
          }

          if (now < current.token.iat || now >= current.token.exp) {
            return yield* refusal(
              "Run refused",
              "claim token is not current",
              "ask the launcher for a fresh run and token"
            );
          }

          runs.set(run, { state: "bound", token: current.token, workerDid });

          return "bound" as const;
        }
      ),
      close: (run) =>
        Effect.sync(() => {
          runs.set(run, { state: "closed" });
        }),
      open: (run, token, now) =>
        Effect.suspend(() => {
          if (
            runs.has(run) ||
            run.length === 0 ||
            !/^[0-9a-f]{64}$/u.test(token.tokenHash) ||
            !Number.isFinite(now) ||
            !Number.isSafeInteger(token.iat) ||
            !Number.isSafeInteger(token.exp) ||
            token.iat < 0 ||
            token.iat > now ||
            token.exp <= now ||
            token.exp <= token.iat ||
            token.exp - token.iat > 300
          ) {
            return Effect.fail(
              refusal(
                "Run refused",
                "run already exists or token is invalid or exceeds five minutes",
                "open a new run with a fresh short-lived token hash"
              )
            );
          }

          runs.set(run, { state: "open", token: { ...token } });

          return Effect.void;
        }),
      renew: Effect.fn("RunBinding.renew")(
        function* renewRun(run, workerDid, now) {
          yield* decodeDidKey(workerDid);
          const current = runs.get(run);

          if (current?.state !== "bound" || !Number.isFinite(now)) {
            return yield* refusal(
              "Run refused",
              "run is unknown, unclaimed, closed or compromised",
              "claim the run with its token, or ask the launcher for a new run"
            );
          }

          if (current.workerDid !== workerDid) {
            return yield* refusal(
              "Run refused",
              "worker key is not bound to this run",
              "use the bound worker key"
            );
          }

          return "match" as const;
        }
      ),
    });
  });
