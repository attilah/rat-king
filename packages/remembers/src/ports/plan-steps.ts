import { Context } from "effect";

import type {
  CandidateValue,
  DeliveryValue,
  Job,
  MemoryRecordValue,
  SliceKeyValue,
  SliceResultValue,
  Verdict,
} from "../contract.ts";

export class PlanSteps extends Context.Service<
  PlanSteps,
  {
    readonly think: (
      delivery: DeliveryValue,
      key: SliceKeyValue
    ) => Job<SliceResultValue>;
    readonly judge: (
      delivery: DeliveryValue,
      candidate: CandidateValue
    ) => Job<typeof Verdict.Type>;
    readonly dedupe: (
      delivery: DeliveryValue,
      results: readonly SliceResultValue[]
    ) => Job<readonly MemoryRecordValue[]>;
  }
>()("remembers/PlanSteps") {}
