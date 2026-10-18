import { Context } from "effect";

import type { ClaimValue, Job } from "../contract.ts";

export class CanonSource extends Context.Service<
  CanonSource,
  {
    readonly loaded: () => Job<readonly string[]>;
    readonly states: (
      claim: ClaimValue,
      canon: readonly string[]
    ) => Job<boolean>;
  }
>()("remembers/CanonSource") {}
