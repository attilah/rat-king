import { Context } from "effect";

import type {
  CiteRefValue,
  DefectValue,
  Job,
  Page,
  SliceKeyValue,
  SliceValue,
} from "../contract.ts";

export class SliceSource extends Context.Service<
  SliceSource,
  {
    readonly page: (cursor: string) => Job<typeof Page.Type>;
    readonly read: (key: SliceKeyValue) => Job<SliceValue>;
    readonly quote: (cite: CiteRefValue) => Job<string | null>;
    readonly defectCount: (defect: DefectValue, since: number) => Job<number>;
  }
>()("remembers/SliceSource") {}
