import { Context } from "effect";
import type { Effect } from "effect";

import type { AlertValue } from "./contracts.ts";
import type { BillingFailure } from "./failure.ts";

export class AlertQueue extends Context.Service<
  AlertQueue,
  {
    readonly insert: (alert: AlertValue) => Effect.Effect<void, BillingFailure>;
    readonly pull: () => Effect.Effect<readonly AlertValue[], BillingFailure>;
    readonly ack: (
      ids: readonly string[]
    ) => Effect.Effect<void, BillingFailure>;
  }
>()("Billing.AlertQueue") {}
