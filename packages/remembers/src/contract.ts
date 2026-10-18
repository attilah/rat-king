import { Schema } from "effect";
import type { Effect } from "effect";

import { codePoints } from "./code-points.ts";

export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const SliceKey = Schema.Struct({
  conversation: Schema.NonEmptyString,
  first_chunk: Schema.NonEmptyString,
  last_chunk: Schema.NonEmptyString,
});

export type SliceKeyValue = typeof SliceKey.Type;

export const CiteRef = Schema.Struct({
  chunk_id: Schema.NonEmptyString,
  end: Count,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  start: Count,
}).check(
  Schema.makeFilter(
    (cite) => cite.end > cite.start && cite.end - cite.start <= 280
  )
);

export type CiteRefValue = typeof CiteRef.Type;

export const VersionVector = Schema.Record(Schema.String, Count);

export const DefectSignature = Schema.NonEmptyString.check(
  Schema.makeFilter((literal) => {
    const { length } = codePoints(literal);

    return length >= 8 && length <= 23;
  })
);

export const Defect = Schema.Struct({
  component: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  impact: Schema.Literals([1, 2, 3]),
  owner: Schema.NonEmptyString,
  signature: Schema.Struct({
    literal: DefectSignature,
    role: Schema.NullOr(Schema.NonEmptyString),
  }),
});

export type DefectValue = typeof Defect.Type;

export const Claim = Schema.Struct({
  concepts: Schema.NonEmptyArray(Schema.NonEmptyString),
  defect: Schema.NullOr(Defect),
  kind: Schema.Literals([
    "decision",
    "fact",
    "preference",
    "gotcha",
    "correction",
  ]),
  privacy: Schema.Literals([
    "public",
    "private",
    "sensitive",
    "secret",
    "customer",
    "personal",
  ]),
  project: Schema.NonEmptyString,
  recheck: Schema.Literals(["release", "commit", "activity", "contradiction"]),
  sentence: Schema.NonEmptyString.check(Schema.isMaxLength(280)),
  type: Schema.Literals([
    "policy",
    "product_rule",
    "decision",
    "preference",
    "defect",
    "fact",
  ]),
});

export type ClaimValue = typeof Claim.Type;

export const Candidate = Schema.Struct({
  cites: Schema.NonEmptyArray(CiteRef),
  claim: Claim,
  subject: VersionVector,
});

export type CandidateValue = typeof Candidate.Type;

export const Observation = Schema.Struct({
  at: Count,
  conversation: Schema.NonEmptyString,
});

export const MemoryRecord = Schema.Struct({
  ...Candidate.fields,
  id: Schema.NonEmptyString,
  invalid_at: Schema.NullOr(Count),
  reobserved: Schema.NonEmptyArray(Observation),
  stability_days: Schema.Finite.check(Schema.isGreaterThan(0)),
  uses: Schema.Array(Schema.Struct({ at: Count, id: Schema.NonEmptyString })),
  valid_from: Count,
});

export type MemoryRecordValue = typeof MemoryRecord.Type;

export const RunBooks = Schema.Struct({
  cite_failed: Count,
  cites_verified: Count,
  dedupe_merges: Count,
  defects_fired: Count,
  failed_slices: Count,
  gated_in: Count,
  novelty_dropped: Count,
  observed: Count,
  privacy_dropped: Count,
  slices_read: Count,
  stored: Count,
  unsafe_dropped: Count,
});

export type RunBooksValue = typeof RunBooks.Type;

export const Delivery = Schema.Struct({
  epoch: Count,
  key: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  visit: Count,
});

export type DeliveryValue = typeof Delivery.Type;

export const Page = Schema.Struct({
  cursor: Schema.String,
  keys: Schema.Array(SliceKey),
});

export const Slice = Schema.Struct({
  chunks: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      role: Schema.String,
      text: Schema.String,
    })
  ),
  key: SliceKey,
});

export type SliceValue = typeof Slice.Type;

export const Verdict = Schema.Struct({
  stale: Schema.Boolean,
  truthful: Schema.Boolean,
});

export const SliceResult = Schema.Struct({
  books: RunBooks,
  candidates: Schema.Array(Candidate),
  key: SliceKey,
});

export type SliceResultValue = typeof SliceResult.Type;

export const Notice = Schema.Struct({
  encrypted: Schema.Boolean,
  id: Schema.NonEmptyString,
  kind: Schema.Literals(["alarm", "report", "defect"]),
  payload: Schema.String,
  to: Schema.NonEmptyString,
});

export type NoticeValue = typeof Notice.Type;

export class Failure extends Schema.TaggedError<Failure>()("RemembersFailure", {
  code: Schema.String,
  operation: Schema.String,
}) {}

export type Job<A> = Effect.Effect<A, Failure>;

export { SliceSource } from "./ports/slice-source.ts";

const DraftDefect = Schema.Struct({
  ...Defect.fields,
  signature: Schema.Struct({
    literal: Schema.NonEmptyString.check(
      Schema.makeFilter((literal) => codePoints(literal).length <= 200)
    ),
    role: Schema.NullOr(Schema.NonEmptyString),
  }),
});

export const Draft = Schema.Struct({
  claim: Schema.Struct({ ...Claim.fields, defect: Schema.NullOr(DraftDefect) }),
  evidence: Schema.NonEmptyArray(
    Schema.Struct({
      chunk_id: Schema.NonEmptyString,
      quote: Schema.NonEmptyString,
    })
  ),
  subject: VersionVector,
});

export type DraftValue = typeof Draft.Type;

export { Observer } from "./ports/observer.ts";

export { Judge } from "./ports/judge.ts";

export { CanonSource } from "./ports/canon-source.ts";

export { Recheck } from "./ports/recheck.ts";

export { Speaks } from "./ports/speaks.ts";

export { Store } from "./ports/store.ts";

export { PlanSteps } from "./ports/plan-steps.ts";

export const emptyBooks = (): RunBooksValue => ({
  cite_failed: 0,
  cites_verified: 0,
  dedupe_merges: 0,
  defects_fired: 0,
  failed_slices: 0,
  gated_in: 0,
  novelty_dropped: 0,
  observed: 0,
  privacy_dropped: 0,
  slices_read: 0,
  stored: 0,
  unsafe_dropped: 0,
});

export const safePrivacy = (claim: ClaimValue) =>
  ["public", "private", "sensitive"].includes(claim.privacy);
