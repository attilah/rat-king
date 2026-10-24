import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import { Effect, Redacted } from "effect";

import { envQuote } from "./file-content.ts";
import type { ContentFrom } from "./file-content.ts";
import { refuse } from "./files.ts";

export interface CredentialNames {
  readonly accessKey: string;
  readonly secretKey: string;
}

type StoreCredentials =
  | { readonly kind: "references"; readonly names: CredentialNames }
  | {
      readonly accessKey: Output.Output<Redacted.Redacted>;
      readonly kind: "legacy";
      readonly secretKey: Output.Output<Redacted.Redacted>;
    };

export const storeCredentials = Effect.fn("ObjectStore.credentials")(
  function* storeCredentials(props: {
    readonly credentials?: CredentialNames;
    readonly legacyRandomCredentials?: boolean;
  }) {
    if (
      props.credentials !== undefined &&
      props.legacyRandomCredentials !== true
    ) {
      return {
        kind: "references",
        names: props.credentials,
      } satisfies StoreCredentials;
    }

    if (
      props.credentials !== undefined ||
      props.legacyRandomCredentials !== true
    ) {
      return yield* refuse(
        "Declare credential references or explicit legacy Random credentials."
      );
    }

    const access = yield* Random("access-key", { bytes: 16 });
    const secret = yield* Random("secret-key", { bytes: 32 });

    return {
      accessKey: access.text,
      kind: "legacy",
      secretKey: secret.text,
    } satisfies StoreCredentials;
  }
);

export const identityContent = (
  credentials: StoreCredentials,
  instance: string
) => {
  const template = JSON.stringify({
    identities: [
      {
        actions: ["Admin", "Read", "Write", "List", "Tagging"],
        credentials: [
          { accessKey: "{{ACCESS_KEY}}", secretKey: "{{SECRET_KEY}}" },
        ],
        name: instance,
      },
    ],
  })
    .replaceAll('"{{ACCESS_KEY}}"', "{{ACCESS_KEY}}")
    .replaceAll('"{{SECRET_KEY}}"', "{{SECRET_KEY}}");

  if (credentials.kind === "references") {
    return {
      contentFrom: {
        format: "json",
        secrets: {
          ACCESS_KEY: credentials.names.accessKey,
          SECRET_KEY: credentials.names.secretKey,
        },
        template,
      } satisfies ContentFrom,
    };
  }

  return {
    content: Output.all(credentials.accessKey, credentials.secretKey).pipe(
      Output.map(([access, secret]) =>
        Redacted.make(
          template
            .replace("{{ACCESS_KEY}}", JSON.stringify(Redacted.value(access)))
            .replace("{{SECRET_KEY}}", JSON.stringify(Redacted.value(secret)))
        )
      )
    ),
  };
};

export const environmentTemplate = (
  bucket: string,
  url: string,
  tuning: Readonly<Record<string, string>>
) =>
  [
    "AWS_ACCESS_KEY_ID={{ACCESS_KEY}}",
    "AWS_SECRET_ACCESS_KEY={{SECRET_KEY}}",
    "AWS_REGION=us-east-1",
    `S3_ENDPOINT=${envQuote(url)}`,
    `CELLD_BUCKET=${envQuote(`s3://${bucket}`)}`,
    "CELLD_OTEL=0",
    ...Object.keys(tuning)
      .toSorted()
      .map((key) => `${key}=${envQuote(tuning[key] ?? "")}`),
    "",
  ].join("\n");

export const environmentContent = (
  credentials: StoreCredentials,
  name: Output.Output<string>,
  endpoint: Output.Output<string>,
  tuning: Readonly<Record<string, string>> = {}
) => {
  if (credentials.kind === "references") {
    return {
      contentFrom: Output.all(name, endpoint).pipe(
        Output.map(
          ([bucket, url]) =>
            ({
              format: "environment",
              secrets: {
                ACCESS_KEY: credentials.names.accessKey,
                SECRET_KEY: credentials.names.secretKey,
              },
              template: environmentTemplate(bucket, url, tuning),
            }) satisfies ContentFrom
        )
      ),
    };
  }

  return {
    content: Output.all(
      credentials.accessKey,
      credentials.secretKey,
      name,
      endpoint
    ).pipe(
      Output.map(([access, secret, bucket, url]) =>
        Redacted.make(
          environmentTemplate(bucket, url, tuning)
            .replace("{{ACCESS_KEY}}", () => envQuote(Redacted.value(access)))
            .replace("{{SECRET_KEY}}", () => envQuote(Redacted.value(secret)))
        )
      )
    ),
  };
};
