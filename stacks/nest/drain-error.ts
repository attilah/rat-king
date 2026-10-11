import { Data } from "effect";

export class DrainFailure extends Data.TaggedError("DrainFailure")<{
  readonly code: 2 | 3 | 4;
  readonly reason: string;
}> {}
