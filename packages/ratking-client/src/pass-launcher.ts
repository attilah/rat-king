import { canonical } from "@rat-king/envelope/canonical";
import { PassRun } from "@rat-king/lexicon/pass-request";
import { signingKey } from "@rat-king/lexicon/pass-webcrypto";
import { decodeDidKey, signPass } from "@rat-king/lexicon/passes";
import type { SignedPass, SignedTicket } from "@rat-king/lexicon/passes";
import type { TrustFailure } from "@rat-king/lexicon/trust";
import { PublicKey, Signatures } from "@rat-king/lexicon/trust";
import { signatures } from "@rat-king/lexicon/webcrypto";
import { Clock, Context, Effect, Schema, Semaphore } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";

import { passFailure, passIo } from "./pass-registry.ts";
import type { RunRegistry } from "./pass-registry.ts";

export const RenewProof = Schema.Struct({
  nonce: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  now: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  run: PassRun,
  signature: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{86}$/u)),
});

export const RenewRequest = Schema.Struct({
  proof: RenewProof,
  run: PassRun,
  token: Schema.optionalKey(Schema.String),
  workerDid: Schema.String,
});

export const PassStart = Schema.Struct({
  desk: Schema.String,
  run: PassRun,
  scope: Schema.Array(Schema.String),
  ttl: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});

export interface PassResult {
  readonly pass: typeof SignedPass.Type;
  readonly ticket?: typeof SignedTicket.Type;
}

export interface PassEnvironment {
  readonly env: {
    readonly RK_PASS_RUN: string;
    readonly RK_PASS_CLAIM: string;
    readonly RK_PASS_SOCKET: string;
  };
}

export class PassLauncher extends Context.Service<
  PassLauncher,
  {
    readonly close: (run: string) => Effect.Effect<void, TrustFailure>;
    readonly renew: (
      input: typeof RenewRequest.Type
    ) => Effect.Effect<PassResult, TrustFailure>;
    readonly start: (
      input: typeof PassStart.Type
    ) => Effect.Effect<PassEnvironment, TrustFailure>;
  }
>()("ratking/PassLauncher") {}

export const renewalBytes = (
  run: string,
  workerDid: string,
  proof: Pick<typeof RenewProof.Type, "nonce" | "now">
) =>
  canonical({
    domain: "sh.ratking.pass.renew.v1",
    nonce: proof.nonce,
    now: proof.now,
    run,
    workerDid,
  });

const random = (size: number) =>
  Base64Url.encode(crypto.getRandomValues(new Uint8Array(size)));

const seconds = Clock.currentTimeMillis.pipe(
  Effect.map((now) => Math.floor(now / 1000))
);

export interface LauncherOptions {
  readonly desk: string;
  readonly deskDid: string;
  readonly key: Parameters<typeof signPass>[0];
  readonly onBlocked: (run: string, reason: string) => Effect.Effect<void>;
  readonly onRevoke?: (run: string) => Effect.Effect<void>;
  readonly registry: RunRegistry;
  readonly socket: string;
  readonly ticketSource?: Effect.Effect<typeof SignedTicket.Type, TrustFailure>;
}

export const importDeskSigningKey = (jwk: JsonWebKey) =>
  Effect.gen(function* importKey() {
    const publicKey = yield* Schema.decodeUnknownEffect(PublicKey)({
      crv: jwk.crv,
      kty: jwk.kty,
      x: jwk.x,
      y: jwk.y,
    }).pipe(
      Effect.mapError(() => passFailure("desk signing key is malformed"))
    );

    const importJwk: (
      format: "jwk",
      key: JsonWebKey,
      algorithm: EcKeyImportParams,
      extractable: boolean,
      usages: readonly KeyUsage[]
    ) => Promise<CryptoKey> = crypto.subtle.importKey.bind(crypto.subtle);

    const privateKey = yield* passIo(
      importJwk.bind(
        crypto.subtle,
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
      )
    );

    return signingKey(publicKey, privateKey);
  });

const digest = (token: string) =>
  Signatures.use((service) =>
    service.digest(new TextEncoder().encode(token))
  ).pipe(Effect.provide(signatures));

const invalid = () =>
  passFailure(
    "proof is not a fresh signature by the worker key for this run",
    "Renewal refused",
    "sign a fresh proof"
  );

export const makePassLauncher = (options: LauncherOptions) =>
  Effect.gen(function* makeLauncher() {
    const mutex = yield* Semaphore.make(1);
    const nonces = new Map<string, number>();

    const refusals = new Map<
      string,
      { readonly count: number; readonly until: number }
    >();

    const noteRefusal = (run: string, reason: string) =>
      Effect.gen(function* reportRefusal() {
        if (
          reason.includes("token does not match") ||
          reason.includes("claim token is not current") ||
          reason.includes("grant has expired")
        ) {
          yield* options.onBlocked(run, reason);
        }

        if (reason === invalid().reason) {
          const now = yield* seconds;

          for (const [key, value] of refusals) {
            if (value.until <= now) {
              refusals.delete(key);
            }
          }

          const count = (refusals.get(run)?.count ?? 0) + 1;
          refusals.set(run, { count, until: now + 120 });

          if (count === 2) {
            yield* options.onBlocked(run, reason);
          }
        }
      });

    return PassLauncher.of({
      close: Effect.fn("PassLauncher.close")(
        function* closeRun(run) {
          yield* Schema.decodeEffect(PassRun)(run).pipe(
            Effect.mapError(() => passFailure("run handle is malformed"))
          );
          yield* options.registry.close(run, yield* seconds);
          yield* options.onRevoke?.(run) ?? Effect.void;
        },
        (effect) => mutex.withPermit(effect.pipe(Effect.uninterruptible))
      ),
      renew: (input) =>
        mutex.withPermit(
          Effect.gen(function* renewPass() {
            const request = yield* Schema.decodeUnknownEffect(RenewRequest)(
              input
            ).pipe(
              Effect.mapError(() =>
                passFailure("request line is malformed", "Renewal refused")
              )
            );

            const now = yield* seconds;
            const { proof, run, token, workerDid } = request;

            if (proof.run !== run || Math.abs(proof.now - now) > 60) {
              return yield* invalid();
            }

            const key = yield* decodeDidKey(workerDid).pipe(
              Effect.mapError(invalid)
            );

            const valid = yield* Signatures.use((service) =>
              service.verify(
                key,
                renewalBytes(run, workerDid, proof),
                proof.signature
              )
            ).pipe(Effect.provide(signatures), Effect.mapError(invalid));

            if (!valid) {
              return yield* invalid();
            }

            for (const [nonce, until] of nonces) {
              if (until <= now) {
                nonces.delete(nonce);
              }
            }

            if (nonces.has(proof.nonce)) {
              return yield* invalid();
            }

            nonces.set(proof.nonce, now + 120);

            const row = yield* Effect.gen(function* bindAndNotify() {
              const bound = yield* options.registry.use(
                run,
                workerDid,
                token === undefined ? undefined : yield* digest(token),
                now
              );

              if (bound.state === "compromised") {
                const failure = passFailure(
                  "a second worker key presented this run's token",
                  "Run refused",
                  "the run is compromised, report it"
                );

                yield* options.onRevoke?.(run) ?? Effect.void;
                yield* options.onBlocked(run, failure.reason);

                return yield* failure;
              }

              return bound;
            }).pipe(Effect.uninterruptible);

            const pass = yield* signPass(options.key, {
              $type: "sh.ratking.pass",
              desk: options.desk,
              deskDid: options.deskDid,
              exp: Math.min(now + 600, row.grantExp),
              iat: now,
              nonce: random(16),
              run,
              scope: [...row.scope],
              v: 1,
              worker: workerDid,
            }).pipe(
              Effect.tapError((error) => options.onBlocked(run, error.reason))
            );

            const ticket =
              options.ticketSource === undefined
                ? undefined
                : yield* options.ticketSource;

            if (ticket !== undefined) {
              return { pass, ticket };
            }

            return { pass };
          }).pipe(
            Effect.tapError((failure) => noteRefusal(input.run, failure.reason))
          )
        ),
      start: Effect.fn("PassLauncher.start")(function* startPass(input) {
        const request = yield* Schema.decodeUnknownEffect(PassStart)(
          input
        ).pipe(
          Effect.mapError(() => passFailure("launch request is malformed"))
        );

        if (
          request.desk !== options.desk ||
          request.scope.length === 0 ||
          request.scope.some((scope) => scope !== "rk.send.plain")
        ) {
          return yield* passFailure(
            "desk or scope exceeds the launcher ceiling"
          );
        }

        const now = yield* seconds;

        if (!Number.isSafeInteger(now + request.ttl)) {
          return yield* passFailure("grant lifetime is invalid");
        }

        const token = random(32);
        yield* options.registry.open(
          request.run,
          {
            grantExp: now + request.ttl,
            scope: request.scope.length === 0 ? [] : ["rk.send.plain"],
            state: "open",
            tokenExp: now + 300,
            tokenHash: yield* digest(token),
            tokenIat: now,
          },
          now
        );

        return {
          env: {
            RK_PASS_CLAIM: token,
            RK_PASS_RUN: request.run,
            RK_PASS_SOCKET: options.socket,
          },
        };
      }),
    });
  });
