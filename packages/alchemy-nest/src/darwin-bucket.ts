import { Resource } from "alchemy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Effect, Schedule, Schema } from "effect";

import { absent } from "./absent.ts";
import { bucketRequest } from "./bucket-api.ts";
import { refuse } from "./files.ts";
import { HostShell } from "./host-shell.ts";
import type { Interface } from "./host-shell.ts";

const LocalBucketSchema = Schema.Struct({
  config: Schema.String,
  endpoint: Schema.String.check(
    Schema.isPattern(/^http:\/\/127\.0\.0\.1:\d{4,5}$/u)
  ),
  name: Schema.String.check(
    Schema.isPattern(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u)
  ),
  ready: Schema.String,
});

type Props = typeof LocalBucketSchema.Type;

type Attributes = Pick<Props, "name" | "endpoint" | "config">;

type LocalBucketResource = Resource<"Darwin.LocalBucket", Props, Attributes>;

export const LocalBucket = Resource<LocalBucketResource>("Darwin.LocalBucket");

const readBucket = Effect.fn("Darwin.LocalBucket.read")(function* readBucket(
  shell: Interface,
  props: Props
) {
  yield* Schema.decodeEffect(LocalBucketSchema)(props).pipe(
    Effect.mapError(() => refuse("Invalid local bucket configuration."))
  );

  const result = yield* bucketRequest(shell, props, "read").pipe(
    Effect.retry(
      Schedule.spaced("100 millis").pipe(Schedule.upTo({ times: 50 }))
    )
  );

  if (result.status === 404) {
    return absent;
  }

  const version = yield* bucketRequest(shell, props, "version");

  if (
    result.status !== 200 ||
    version.status !== 200 ||
    version.version !== ""
  ) {
    return yield* refuse("Local bucket read or versioning check failed.");
  }

  return {
    config: props.config,
    endpoint: props.endpoint,
    name: props.name,
  } satisfies Attributes;
});

export const LocalBucketProvider = () =>
  Provider.effect(
    LocalBucket,
    Effect.gen(function* provider() {
      const shell = yield* HostShell;

      return LocalBucket.Provider.of({
        delete: () => Effect.void,
        diff: Effect.fn("Darwin.LocalBucket.diff")(function* diff({
          news,
          output,
        }) {
          if (!isResolved(news)) {
            return absent;
          }

          if (
            output !== undefined &&
            (news.name !== output.name ||
              news.endpoint !== output.endpoint ||
              news.config !== output.config)
          ) {
            return yield* refuse(
              "Local bucket identity changes require a new resource."
            );
          }

          return {
            action:
              output === undefined ||
              (yield* readBucket(shell, news)) === undefined
                ? "update"
                : "noop",
          };
        }),
        list: () => Effect.succeed([]),
        read: ({ olds, output }) =>
          output === undefined
            ? Effect.succeed(absent)
            : readBucket(shell, olds),
        reconcile: Effect.fn("Darwin.LocalBucket.reconcile")(
          function* reconcile({ news, output }) {
            const live = yield* readBucket(shell, news);

            if (live !== undefined && output === undefined) {
              return yield* refuse("Existing local bucket cannot be adopted.");
            }

            if (live !== undefined) {
              return live;
            }

            if ((yield* bucketRequest(shell, news, "create")).status !== 200) {
              return yield* refuse("Local bucket creation failed.");
            }

            const after = yield* readBucket(shell, news);

            return (
              after ?? (yield* refuse("Local bucket creation failed readback."))
            );
          }
        ),
      });
    })
  );
