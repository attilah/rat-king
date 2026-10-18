import { Config, Context, Effect, FileSystem, Layer, Schema } from "effect";

import { CanonSource, Failure, Judge, Observer } from "../src/contract.ts";
import type {
  CandidateValue,
  Job,
  SliceValue,
  DraftValue,
  Verdict,
} from "../src/contract.ts";

export class Models extends Context.Service<
  Models,
  {
    readonly observe: (
      prefix: string,
      slice: SliceValue
    ) => Job<readonly DraftValue[]>;
    readonly judge: (
      rubric: string,
      candidate: CandidateValue
    ) => Job<typeof Verdict.Type>;
  }
>()("remembers/Models") {}

const normalize = (text: string) =>
  text.trim().toLowerCase().replaceAll(/\s+/gu, " ");

export const privateModels = Layer.effectContext(
  Effect.gen(function* privateModels() {
    const config = yield* Config.all({
      canon: Config.String("REMEMBERS_CANON_PATHS"),
      observer: Config.String("REMEMBERS_OBSERVER_PREFIX_PATH"),
      rubric: Config.String("REMEMBERS_JUDGE_RUBRIC_PATH"),
    });

    const files = yield* FileSystem.FileSystem;
    const models = yield* Models;

    const read = (path: string) =>
      files.readFileString(path).pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.NonEmptyString)),
        Effect.mapError(
          () => new Failure({ code: "private_file", operation: "load" })
        )
      );

    const prefix = yield* read(config.observer);
    const rubric = yield* read(config.rubric);

    const paths = yield* Schema.decodeEffect(
      Schema.fromJsonString(Schema.NonEmptyArray(Schema.NonEmptyString))
    )(config.canon).pipe(
      Effect.mapError(
        () => new Failure({ code: "canon_paths", operation: "load" })
      )
    );

    const loaded = yield* Effect.forEach(read)(paths);

    return Context.make(
      Observer,
      Observer.of({ think: (slice) => models.observe(prefix, slice) })
    ).pipe(
      Context.add(
        Judge,
        Judge.of({ judge: (candidate) => models.judge(rubric, candidate) })
      ),
      Context.add(
        CanonSource,
        CanonSource.of({
          loaded: () => Effect.succeed(loaded),
          states: (claim, canon) =>
            Effect.succeed(
              canon.some((text) =>
                normalize(text).includes(normalize(claim.sentence))
              )
            ),
        })
      )
    );
  })
);
