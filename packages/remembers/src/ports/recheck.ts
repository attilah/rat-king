import { Context } from "effect";

import type { DeliveryValue, Job, MemoryRecordValue } from "../contract.ts";

export class Recheck extends Context.Service<
  Recheck,
  {
    readonly arm: (
      record: MemoryRecordValue,
      delivery: DeliveryValue
    ) => Job<void>;
  }
>()("remembers/Recheck") {}
