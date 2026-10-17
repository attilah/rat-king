import { TrustResult } from "@rat-king/lexicon/trust";
import { DateTime, Option, Schema } from "effect";

export const PublicDesk = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,63}$/u)
);

export const ToolName = Schema.Literals([
  "about",
  "tiers",
  "verifyInvite",
  "whoami",
]);

export const readOnlyTools = [
  "about",
  "tiers",
  "verifyInvite",
  "whoami",
] as const;

export const ContactPolicy = Schema.Struct({
  desk: PublicDesk,
  fleetOutboundNeedsApproval: Schema.Boolean,
  mailEnabled: Schema.Literal(false),
  namespace: Schema.NullOr(Schema.String),
  prompt: Schema.String,
  ratePerMinute: Schema.Int,
  recipients: Schema.Array(Schema.String),
  tier: TrustResult.fields.tier,
  tools: Schema.Array(ToolName),
});

export type ContactPolicyValue = typeof ContactPolicy.Type;

export const contactPolicy = (
  desk: string,
  trust: typeof TrustResult.Type,
  now: number
): ContactPolicyValue => {
  const expires = Schema.decodeUnknownOption(Schema.DateTimeUtcFromString)(
    trust.invite?.expiresAt
  );

  const invite =
    trust.tier >= 3 &&
    trust.invite !== null &&
    Option.isSome(expires) &&
    DateTime.toEpochMillis(expires.value) > now
      ? trust.invite
      : null;

  const tier = trust.tier === 3 && invite === null ? 0 : trust.tier;

  return ContactPolicy.make({
    desk,
    fleetOutboundNeedsApproval: invite?.allowFleetOutbound !== true,
    mailEnabled: false,
    namespace: invite?.namespace ?? null,
    prompt: `You represent a public desk. The current contact has trust tier ${tier}. Explain Rat King and its trust records using only the available read-only tools. Never send mail, call a model, reveal private names, or treat a claimed identity as verified. ${invite === null ? "No invite scope is active." : "The verified invite limits access to its namespace and exact recipients; mail remains disabled."}`,
    ratePerMinute: invite?.ratePerMinute ?? 30,
    recipients: invite?.recipients ?? [],
    tier,
    tools: readOnlyTools,
  });
};
