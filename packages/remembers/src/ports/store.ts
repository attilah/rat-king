import { Context } from "effect";

import type {
  DefectValue,
  DeliveryValue,
  Job,
  MemoryRecordValue,
  RunBooksValue,
} from "../contract.ts";

export class Store extends Context.Service<
  Store,
  {
    readonly cursor: () => Job<string>;
    readonly commit: (
      delivery: DeliveryValue,
      records: readonly MemoryRecordValue[]
    ) => Job<number>;
    readonly search: (
      text: string,
      project: string | null
    ) => Job<readonly MemoryRecordValue[]>;
    readonly use: (
      project: string,
      id: string,
      useId: string,
      at: number
    ) => Job<void>;
    readonly start: (runId: string) => Job<void>;
    readonly owed: () => Job<readonly string[]>;
    readonly finish: (
      runId: string,
      cursor: string,
      books: RunBooksValue
    ) => Job<void>;
    readonly defects: () => Job<readonly DefectValue[]>;
    readonly fired: (id: string) => Job<boolean>;
    readonly markFired: (id: string) => Job<void>;
  }
>()("remembers/Store") {}
