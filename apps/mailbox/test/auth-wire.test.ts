import { it } from "@effect/vitest";
import {
  authenticateClaims,
  serviceToken,
  staticResolver,
} from "@rat-king/mailbox-client/auth";
import { Effect, Layer, Schema } from "effect";
import { expect } from "vitest";

import { importSigning } from "../../../packages/mailbox-client/src/identity.ts";
import { ReplayAuthority } from "../../../packages/mailbox-client/src/replay.ts";
import {
  document,
  identity,
} from "../../../packages/mailbox-client/test/identity.ts";
import { errorResponse, failure } from "../src/failure.ts";

it.effect.prop(
  "mailbox auth refusals preserve wire bytes and catchTag compatibility",
  [Schema.Int.check(Schema.isBetween({ maximum: 1_000_000, minimum: 100 }))],
  ([now]) =>
    Effect.gen(function* wireProof() {
      const sender = yield* identity("did:web:sender.invalid");
      const other = yield* identity(sender.did);
      const key = yield* importSigning(sender);
      const wrongKey = yield* importSigning(other);
      const used = new Set<string>();

      const services = Layer.merge(
        staticResolver([yield* document(sender)]),
        Layer.succeed(ReplayAuthority, {
          consume: (claims) =>
            Effect.suspend(() => {
              if (used.has(claims.jti)) {
                return Effect.fail(
                  failure("AuthRequired", 401, "Reused service token")
                );
              }

              used.add(claims.jti);

              return Effect.void;
            }),
        })
      );

      const claims = {
        aud: "did:web:mailbox.invalid#mailbox",
        exp: now + 60,
        iat: now,
        iss: sender.did,
        jti: "wire-auth-valid-token-0001",
        lxm: "sh.mschf.ratking.mailbox.send",
      };

      let caught = 0;

      const run = (authorization: string | null) =>
        authenticateClaims({
          audience: claims.aud,
          authorization,
          now: now * 1000,
          nsid: claims.lxm,
        }).pipe(
          Effect.provide(services),
          Effect.catchTag("XrpcFailure", (refusal) =>
            Effect.gen(function* renderFailure() {
              caught += 1;
              const response = errorResponse(refusal);

              return {
                body: yield* Effect.promise(response.text.bind(response)),
                status: response.status,
              };
            })
          )
        );

      const valid = yield* serviceToken(claims, key);
      expect(yield* run(`Bearer ${valid}`)).toEqual(claims);

      const bad = yield* serviceToken(
        { ...claims, jti: "wire-auth-wrong-key-0002" },
        wrongKey
      );

      const expired = yield* serviceToken(
        {
          ...claims,
          exp: now,
          iat: now - 60,
          jti: "wire-auth-expired-token-0003",
        },
        key
      );

      for (const [authorization, body] of [
        [null, '{"error":"AuthRequired","message":"AuthRequired"}'],
        [`Bearer ${bad}`, '{"error":"AuthRequired","message":"AuthRequired"}'],
        [
          `Bearer ${expired}`,
          '{"error":"AuthRequired","message":"Invalid service-auth claims"}',
        ],
        [
          `Bearer ${valid}`,
          '{"error":"AuthRequired","message":"Reused service token"}',
        ],
      ] as const) {
        expect(yield* run(authorization)).toEqual({ body, status: 401 });
      }

      expect(caught).toBe(4);
    })
);
