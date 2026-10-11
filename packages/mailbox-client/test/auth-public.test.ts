import { it } from "@effect/vitest";
import { Arbitrary, Effect, Layer, Result, Schema } from "effect";
import { expect } from "vitest";

import { XrpcFailure } from "../../lexicon/src/xrpc-failure.ts";
import { importSigning } from "../src/identity.ts";
import {
  authenticateClaims,
  ReplayAuthority,
  serviceToken,
  staticResolver,
} from "../src/index.ts";
import type { ClaimsValue } from "../src/index.ts";
import { document, identity } from "./identity.ts";

const refused = (
  result: Result.Result<ClaimsValue, XrpcFailure>,
  code: string
) => {
  expect(Result.isFailure(result)).toBe(true);

  if (Result.isFailure(result)) {
    expect(result.failure.error).toBe(code);
    expect(result.failure.status).toBe(code === "Forbidden" ? 403 : 401);
  }
};

it.effect.prop(
  "public verifier preserves signature, claims, DID and replay refusal codes",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1_000_000, minimum: 100 }))
    ),
  ],
  ([now]) =>
    Effect.gen(function* proof() {
      const sender = yield* identity("did:web:sender.invalid");
      const wrong = yield* identity(sender.did);
      const doc = yield* document(sender);
      const key = yield* importSigning(sender);
      const wrongKey = yield* importSigning(wrong);
      const used = new Set<string>();

      const replay = Layer.succeed(ReplayAuthority, {
        consume: (claims) =>
          Effect.suspend(() => {
            if (used.has(claims.jti)) {
              return Effect.fail(
                new XrpcFailure({
                  error: "AuthRequired",
                  response: {},
                  status: 401,
                })
              );
            }

            used.add(claims.jti);

            return Effect.void;
          }),
      });

      const claims = {
        aud: "did:web:mischief.invalid",
        exp: now + 60,
        iat: now,
        iss: sender.did,
        jti: "public-verifier-jti-0001",
        lxm: "sh.mschf.mischief.run",
      };

      const run = (authorization: string) =>
        authenticateClaims({
          audience: claims.aud,
          authorization,
          now: now * 1000,
          nsid: claims.lxm,
        }).pipe(
          Effect.provide(Layer.merge(staticResolver([doc]), replay)),
          Effect.result
        );

      const token = yield* serviceToken(claims, key);
      expect(yield* run(`Bearer ${token}`)).toEqual(Result.succeed(claims));

      refused(yield* run(`Bearer ${token}`), "AuthRequired");
      refused(
        yield* run(
          `Bearer ${yield* serviceToken({ ...claims, jti: "public-verifier-jti-0002" }, wrongKey)}`
        ),
        "AuthRequired"
      );

      for (const altered of [
        { ...claims, aud: "did:web:wrong.invalid" },
        { ...claims, lxm: "sh.mschf.mischief.other" },
        { ...claims, exp: now },
        { ...claims, iat: now + 1 },
        { ...claims, exp: now + 61 },
        { ...claims, iat: now - 61 },
        { ...claims, exp: now - 1, iat: now - 1 },
      ]) {
        refused(
          yield* run(`Bearer ${yield* serviceToken(altered, key)}`),
          "AuthRequired"
        );
      }

      refused(
        yield* run(
          `Bearer ${yield* serviceToken({ ...claims, iss: "did:web:unknown.invalid" }, key)}`
        ),
        "Forbidden"
      );
      refused(
        yield* run(`Bearer ${yield* serviceToken(claims, key, "#unknown")}`),
        "Forbidden"
      );
      refused(yield* run("Bearer malformed"), "AuthRequired");
      const fresh = { ...claims, jti: "public-verifier-jti-0003" };
      expect(
        yield* run(
          `Bearer ${yield* serviceToken(fresh, key, `${sender.did}#atproto`)}`
        )
      ).toEqual(Result.succeed(fresh));
    })
);
