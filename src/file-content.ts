import { Effect, Option, Redacted, Schema } from "effect";

import { HostError } from "./host-error.ts";
import { SecretName, SecretRef, SecretSource } from "./secret-source.ts";

export const TemplateSource = Schema.Struct({
  format: Schema.optionalKey(Schema.Literals(["environment", "json", "text"])),
  secrets: Schema.Record(Schema.String, SecretName),
  template: Schema.String,
});

export const ContentFromSchema = Schema.Union([SecretRef, TemplateSource]);

export type ContentFrom = typeof ContentFromSchema.Type;

export const envQuote = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`;

const encodeValue = (value: string, format: string | undefined): string => {
  if (format === "json") {
    return JSON.stringify(value);
  }

  return format === "environment" ? envQuote(value) : value;
};

export const renderTemplate = (
  source: typeof TemplateSource.Type,
  values: Readonly<Record<string, string>>
): string | undefined => {
  let missing = false;

  const text = source.template.replaceAll(
    /\{\{(?<key>[A-Z][A-Z0-9_]*)\}\}/gu,
    (_, key: string) => {
      const value = Object.hasOwn(values, key) ? values[key] : undefined;

      if (value === undefined || !Object.hasOwn(source.secrets, key)) {
        missing = true;

        return "";
      }

      return encodeValue(value, source.format);
    }
  );

  return missing ? undefined : text;
};

const refused = (reason: string) =>
  new HostError({ operation: "file content", reason });

export const resolveFileContent = Effect.fn("RemoteFile.resolveContent")(
  function* resolveFileContent(props: {
    readonly content?: string | Redacted.Redacted;
    readonly contentFrom?: ContentFrom;
  }) {
    if (props.contentFrom === undefined) {
      if (props.content === undefined) {
        return yield* refused("Missing content source.");
      }

      return Redacted.isRedacted(props.content)
        ? Redacted.value(props.content)
        : props.content;
    }

    const option = yield* Effect.serviceOption(SecretSource);

    if (Option.isNone(option)) {
      return yield* refused("contentFrom requires a SecretSource layer.");
    }

    const source = option.value;
    const ref = props.contentFrom;

    if ("secret" in ref) {
      return Redacted.value(yield* source.resolve(ref));
    }

    const pairs = yield* Effect.forEach(
      Object.entries(ref.secrets),
      Effect.fn("RemoteFile.resolveTemplateSecret")(function* resolve([
        key,
        secret,
      ]) {
        return [
          key,
          Redacted.value(yield* source.resolve({ secret })),
        ] as const;
      })
    );

    const text = renderTemplate(ref, Object.fromEntries(pairs));

    if (text === undefined) {
      return yield* refused("Template has an unresolved secret placeholder.");
    }

    return text;
  }
);

export const validateContent = (props: {
  readonly content?: string | Redacted.Redacted;
  readonly contentFrom?: ContentFrom;
  readonly mode?: number;
}) => {
  if ((props.content === undefined) === (props.contentFrom === undefined)) {
    return Effect.fail(refused("Declare exactly one content source."));
  }

  if (
    (props.contentFrom !== undefined || Redacted.isRedacted(props.content)) &&
    props.mode !== 0o600
  ) {
    return Effect.fail(refused("Secret file content requires mode 600."));
  }

  return Effect.void;
};
