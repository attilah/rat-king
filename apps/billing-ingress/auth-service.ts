import { Context } from "effect";
import type { Effect } from "effect";

import type { BillingFailure } from "./failure.ts";

export class IngressAuth extends Context.Service<
  IngressAuth,
  {
    readonly webhook: (value: string) => Effect.Effect<boolean, BillingFailure>;
    readonly pull: (value: string) => Effect.Effect<boolean, BillingFailure>;
    readonly limit: () => Effect.Effect<boolean, BillingFailure>;
  }
>()("Billing.IngressAuth") {}
