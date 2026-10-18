import { Context } from "effect";

import type { CandidateValue, Job, Verdict } from "../contract.ts";

export class Judge extends Context.Service<
  Judge,
  { readonly judge: (candidate: CandidateValue) => Job<typeof Verdict.Type> }
>()("remembers/Judge") {}
