// @effect-diagnostics nodeBuiltinImport:off asyncFunction:off -- Node HTTP and subprocesses are the CLI integration test boundary.
/* oxlint-disable typescript/promise-function-async, promise/prefer-await-to-callbacks -- Node HTTP callbacks and acquire/release Promises are fixture adapters. */
import { createServer } from "node:http";

import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { canonical } from "@rat-king/envelope/canonical";
import * as Send from "@rat-king/lexicon/mailbox.send";
import { Entries } from "@rat-king/ratking-client/directory";
import { Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { expect } from "vitest";

import { EnvelopeJson, SealedJson } from "../../../stacks/nest/seal.ts";
import { base64url } from "../../mailbox-client/src/auth.ts";
import { document, identity } from "../../mailbox-client/test/identity.ts";

const SECRET_ENTRY = "example_job_identity";

const NAME = "acme/inbox";

const SENDER = "did:web:acme.job.agents.example.invalid";

const RECIPIENT = "did:web:acme.inbox.agents.example.invalid";

const Output = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, seq: Schema.Int })
);

it.live.prop(
  "Mischief can run the real CLI seal then send the bare envelope twice and read messageId, envelope, id and seq",
  [Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40))],
  ([body]) =>
    Effect.gen(function* cliReplay() {
      const fs = yield* FileSystem.FileSystem;
      const temp = yield* fs.makeTempDirectoryScoped();
      const sender = yield* identity(SENDER);
      const recipient = yield* identity(RECIPIENT);
      const peer = yield* document(recipient);

      const admitted = new Map<
        string,
        { readonly bytes: string; readonly receipt: Send.OutputValue }
      >();

      const posted: string[] = [];

      const server = createServer((request, response) => {
        let text = "";
        request.setEncoding("utf-8");
        request.on("data", (chunk: string) => {
          text += chunk;
        });
        request.on("end", () => {
          expect(request.method).toBe("POST");
          expect(request.url).toBe(`/xrpc/${Send.Method.nsid}`);

          const { envelope } = Schema.decodeUnknownSync(
            Schema.fromJsonString(Send.Input)
          )(text);

          const raw = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.Struct({ envelope: Schema.Json }))
          )(text);

          posted.push(JSON.stringify(raw.envelope));
          const bytes = base64url(canonical(envelope));
          const id = envelope.aad.messageId;
          const existing = admitted.get(id);
          response.setHeader("content-type", "application/json");

          if (existing !== undefined && existing.bytes !== bytes) {
            response.statusCode = 409;
            response.end(JSON.stringify({ error: "Conflict" }));

            return;
          }

          const receipt =
            existing?.receipt ??
            Schema.decodeUnknownSync(Schema.toType(Send.Output))({
              receipt: {
                message: { messageId: id, senderDid: envelope.aad.senderDid },
                recipientDid: envelope.aad.recipientDid,
                seq: admitted.size + 1,
                state: "accepted",
              },
            });

          admitted.set(id, { bytes, receipt });
          response.end(JSON.stringify(Schema.encodeSync(Send.Output)(receipt)));
        });
      });

      yield* Effect.acquireRelease(
        Effect.callback<null>((resume) => {
          server.once("error", (error) => {
            resume(Effect.die(error));
          });
          server.listen(0, "127.0.0.1", () => {
            resume(Effect.succeed(null));
          });
        }),
        () =>
          Effect.callback<null>((resume) => {
            server.close(() => {
              resume(Effect.succeed(null));
            });
            server.closeAllConnections();
          })
      );

      const address = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ port: Schema.Int })
      )(server.address());

      const fixtureCommand = `${temp}/identity-reader.mjs`;
      yield* fs.writeFileString(
        `${temp}/identity.json`,
        JSON.stringify(sender),
        { mode: 0o600 }
      );
      yield* fs.writeFileString(
        fixtureCommand,
        `#!${process.execPath}\nimport { readFileSync } from "node:fs";\nif (process.argv[3] !== "lease" || process.argv[4] !== "${SECRET_ENTRY}") process.exit(2);\nprocess.stdout.write(readFileSync(new URL("./identity.json", import.meta.url), "utf8"));\n`,
        { mode: 0o700 }
      );
      yield* fs.writeFileString(
        `${temp}/directory.json`,
        yield* Schema.encodeEffect(Schema.fromJsonString(Entries))({
          [NAME]: { did: peer.id, document: peer },
        })
      );
      const settings = `${temp}/settings.json`;
      yield* fs.writeFileString(
        settings,
        JSON.stringify({
          didTemplate: "did:web:{agent}.agents.example.invalid",
          directory: `${temp}/directory.json`,
          endpoint: `http://127.0.0.1:${address.port}`,
          secretsCommand: fixtureCommand,
          serviceDid: "did:web:mailbox.example.invalid",
          state: `${temp}/state`,
        })
      );
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const cli = (args: readonly string[], stdin: string) =>
        Effect.gen(function* spawnCli() {
          const handle = yield* spawner.spawn(
            ChildProcess.make(
              process.execPath,
              [
                new URL("../../../stacks/nest/cli.ts", import.meta.url)
                  .pathname,
                ...args,
              ],
              {
                env: { HOME: temp, RATKING_CONFIG: settings },
                stderr: "pipe",
                stdin: Stream.succeed(new TextEncoder().encode(stdin)),
              }
            )
          );

          const [code, stdout, stderr] = yield* Effect.all(
            [
              handle.exitCode,
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
            ],
            { concurrency: "unbounded" }
          );

          return { code, stderr, stdout };
        }).pipe(Effect.scoped);

      const sealed = yield* cli(
        ["seal", "--as", SECRET_ENTRY, "--to", NAME, "--body", "-"],
        body
      );

      expect(sealed.code).toBe(0);
      expect(sealed.stderr).toBe("");
      expect(admitted.size).toBe(0);
      const journal = yield* Schema.decodeEffect(SealedJson)(sealed.stdout);
      expect(Object.keys(journal).toSorted()).toEqual([
        "envelope",
        "messageId",
        "to",
      ]);
      expect(journal.messageId).toBe(journal.envelope.aad.messageId);
      expect(journal.to).toBe(NAME);
      const bytes = yield* Schema.encodeEffect(EnvelopeJson)(journal.envelope);

      const sent = yield* cli(
        ["send", "--as", SECRET_ENTRY, "--sealed", "-"],
        bytes
      );

      const resent = yield* cli(
        ["send", "--as", SECRET_ENTRY, "--sealed", "-"],
        bytes
      );

      for (const result of [sent, resent]) {
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        const receipt = yield* Schema.decodeEffect(Output)(result.stdout);
        expect(receipt).toEqual({ id: journal.messageId, seq: 1 });
      }

      expect(sent.stdout).toBe(resent.stdout);
      expect(admitted.size).toBe(1);
      expect(posted).toEqual([bytes, bytes]);

      const unsupported = yield* cli(
        [
          "seal",
          "--as",
          SECRET_ENTRY,
          "--to",
          NAME,
          "--body",
          "Ignored",
          "--cc",
          "acme/watch",
        ],
        ""
      );

      expect(unsupported.code).toBe(2);
      expect(unsupported.stderr).toContain("Unknown or repeated flag --cc");

      const wrapped = yield* cli(
        ["send", "--as", SECRET_ENTRY, "--sealed", "-"],
        sealed.stdout
      );

      expect(wrapped.code).toBe(2);
      expect(posted).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 3 }, timeout: 30_000 }
);
