import { Effect, Redacted, Schema } from "effect";

import {
  AbsolutePath,
  FileSchema as MailboxFileSchema,
  reconcileBytes,
  refuse,
} from "./files.ts";
import type { FileAttributes } from "./files.ts";
import type { Interface } from "./host-shell.ts";

export {
  AbsolutePath,
  DirectorySchema,
  deleteDirectory,
  deleteFile,
  directoryPolicy,
  fileText,
  readDirectory,
  readFile,
  reconcileDirectory,
  textDigest,
  validateDirectory,
} from "./files.ts";

export type {
  DirectoryAttributes,
  DirectoryProps,
  FileAttributes,
} from "./files.ts";

export const FileSchema = Schema.Struct({
  ...MailboxFileSchema.fields,
  rotationOwner: Schema.optionalKey(
    Schema.Struct({
      home: AbsolutePath,
      name: Schema.String.check(
        Schema.isPattern(/^[a-z][a-z0-9-]{0,15}-(?:seaweedfs|celld)\.service$/u)
      ),
      sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
    })
  ),
});

export type FileProps = typeof FileSchema.Type;

export const validateFile = Effect.fn("RemoteFile.validate")(function* validate(
  props: FileProps
) {
  const valid = yield* Schema.decodeEffect(FileSchema)(props).pipe(
    Effect.mapError(() => refuse("Invalid file declaration."))
  );

  if (Redacted.isRedacted(valid.content) && valid.mode !== 0o600) {
    return yield* refuse("Secret file content requires mode 600.");
  }

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

    return yield* reconcileBytes(
      shell,
      {
        bytes: new TextEncoder().encode(
          Redacted.isRedacted(valid.content)
            ? Redacted.value(valid.content)
            : valid.content
        ),
        mode: valid.mode ?? 0o644,
        path: valid.path,
      },
      output,
      adopt
    );
  }
);
