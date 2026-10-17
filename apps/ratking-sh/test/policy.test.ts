import { it } from "@effect/vitest";
import { TrustResult, Tier, verifyInvite } from "@rat-king/lexicon/trust";
import { signatures } from "@rat-king/lexicon/webcrypto";
import { Arbitrary, DateTime, Effect, Schema } from "effect";
import { expect } from "vitest";

import { fixture, now } from "../../../packages/lexicon/test/trust-helpers.ts";
import { authorityFrom, Directory } from "../src/authority.ts";
import { contactPolicy, readOnlyTools } from "../src/policy.ts";

const Admission = Schema.Struct({
  allowOutbound: Schema.Boolean,
  expired: Schema.Boolean,
  tier: Tier,
});

it.prop(
  "contact prompts and access derive only from current tier and invite scope; all tiers stay read-only",
  [Arbitrary.schema(Admission)],
  ([input]) => {
    const active = input.tier >= 3 && !input.expired;

    const trust = TrustResult.make({
      fingerprint: "a".repeat(64),
      handle: "ext/example/guest",
      invite: {
        allowFleetOutbound: input.allowOutbound,
        expiresAt: input.expired
          ? "2030-01-01T00:00:00Z"
          : "2030-01-01T01:00:00Z",
        fingerprint: "b".repeat(64),
        namespace: "ext/example/",
        ratePerMinute: 7,
        recipients: ["lobby"],
        tier: 3,
      },
      subject: null,
      tier: input.tier,
    });

    const policy = contactPolicy("lobby", trust, now);

    expect(policy.tools).toEqual(readOnlyTools);
    expect(policy.mailEnabled).toBe(false);
    expect(policy.namespace).toBe(active ? "ext/example/" : null);
    expect(policy.recipients).toEqual(active ? ["lobby"] : []);
    expect(policy.ratePerMinute).toBe(active ? 7 : 30);
    expect(policy.fleetOutboundNeedsApproval).toBe(
      !(active && input.allowOutbound)
    );
    expect(policy.tier).toBe(
      input.tier === 3 && input.expired ? 0 : input.tier
    );
    expect(policy.prompt).toContain(`trust tier ${policy.tier}`);
  }
);

it.effect.prop(
  "absent and stale directory snapshots never establish a fleet vouch",
  [Arbitrary.schema(Schema.Boolean)],
  ([missing]) =>
    Effect.gen(function* staleAuthority() {
      const sample = yield* fixture;

      const stale = Directory.make({
        expiresAt: DateTime.makeUnsafe(0),
        identities: [],
        issuers: [],
        revocations: [],
      });

      const result = yield* verifyInvite(
        sample.invite,
        {
          handle: "ext/example/guest",
          recipient: "lobby",
          subject: sample.invite.record.subject,
          subjectKey: sample.fingerprint,
        },
        now
      ).pipe(
        Effect.provide(authorityFrom(missing ? undefined : stale)),
        Effect.flip
      );

      expect(result.reason).toBe("Trust authority is unavailable or stale");
    }).pipe(Effect.provide(signatures)),
  { arbitrary: { runs: 5 } }
);
