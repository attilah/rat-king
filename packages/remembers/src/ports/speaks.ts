import { Context } from "effect";

import type { Job, NoticeValue } from "../contract.ts";

export class Speaks extends Context.Service<
  Speaks,
  { readonly send: (notice: NoticeValue) => Job<void> }
>()("remembers/Speaks") {}
