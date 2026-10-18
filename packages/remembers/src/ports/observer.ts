import { Context } from "effect";

import type { DraftValue, Job, SliceValue } from "../contract.ts";

export class Observer extends Context.Service<
  Observer,
  { readonly think: (slice: SliceValue) => Job<readonly DraftValue[]> }
>()("remembers/Observer") {}
