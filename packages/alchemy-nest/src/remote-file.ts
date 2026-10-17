import { Effect, Schema } from "effect";

import {
  ContentFromSchema,
  resolveFileContent,
  validateContent,
} from "./file-content.ts";
import { reconcileBytes, refuse } from "./files.ts";
import type { FileAttributes } from "./files.ts";
import type { Interface } from "./host-shell.ts";
import { FileSchema as LegacyFileSchema } from "./instance-files.ts";

export const FileSchema = Schema.Struct({
  ...LegacyFileSchema.fields,
  content: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Redacted(Schema.String)])
  ),
  contentFrom: Schema.optionalKey(ContentFromSchema),
});

export type FileProps = typeof FileSchema.Type;

export const validateFile = Effect.fn("RemoteFile.validate")(function* validate(
  props: FileProps
) {
  const valid = yield* Schema.decodeEffect(FileSchema)(props).pipe(
    Effect.mapError(() => refuse("Invalid file declaration."))
  );

  yield* validateContent(valid);

  return valid;
});

export const reconcileFile = Effect.fn("RemoteFile.reconcile")(
  function* reconcile(
    shell: Interface,
    props: FileProps,
    output: FileAttributes | undefined,
    adopt: boolean
  ) {
    const valid = yield* validateFile(props);

    const installed = yield* reconcileBytes(
      shell,
      {
        bytes: new TextEncoder().encode(yield* resolveFileContent(valid)),
        mode: valid.mode ?? 0o644,
        path: valid.path,
      },
      output,
      adopt
    );

    return valid.contentFrom === undefined
      ? installed
      : { ...installed, contentFrom: valid.contentFrom };
  }
);
