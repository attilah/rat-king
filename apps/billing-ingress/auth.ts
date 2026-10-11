// @effect-diagnostics nodeBuiltinImport:off -- Cloudflare nodejs_compat supplies native constant-time comparison.
import { timingSafeEqual } from "node:crypto";

import { Effect } from "effect";

import { digest } from "./http.ts";

export const secretMatches = Effect.fn("Billing.secretMatches")(
  function* secretMatches(expected: string, supplied: string) {
    const left = yield* digest(expected);
    const right = yield* digest(supplied);

    const same = timingSafeEqual(
      new TextEncoder().encode(left),
      new TextEncoder().encode(right)
    );

    return expected.length > 0 && supplied.length > 0 && same;
  }
);
