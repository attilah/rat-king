import { TrustFailure } from "./trust-failure.ts";

export const refusal = (what: string, why: string, next: string) =>
  new TrustFailure({ reason: `${what}; ${why}; ${next}` });
