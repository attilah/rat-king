import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  Arbitrary,
  ConfigProvider,
  Effect,
  FileSystem,
  Option,
  Schema,
} from "effect";
import { expect } from "vitest";

import { collectFacts } from "../src/extension.ts";
import type { NameEntryValue } from "../src/name.ts";

it.effect.prop(
  "fork env compares canonical names, honors a different explicit name and restores its own recorded name",
  [
    Arbitrary.schema(
      Schema.Literals(["alias", "explicit", "normal", "resume"])
    ),
    Arbitrary.schema(Schema.Boolean),
  ],
  ([mode, storedAlias]) =>
    Effect.gen(function* proof() {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const config = `${dir}/pi.json`;

      yield* fs.writeFileString(
        config,
        JSON.stringify({
          didTemplate: "did:web:{agent}.example.invalid",
          endpoint: "https://mailbox.example.invalid",
          reserved: {
            switchboard: {
              aliases: ["sb"],
              did: "did:web:switchboard.example.invalid",
            },
          },
          serviceDid: "did:web:mailbox.example.invalid",
        })
      );

      const entries: NameEntryValue[] = [
        {
          name: storedAlias ? "sb" : "switchboard",
          session: "parent",
          source: "env",
        },
      ];

      if (mode === "resume") {
        entries.push({
          name: "switchboard/review",
          parent: { name: "switchboard", session: "parent" },
          session: "fork-session",
          source: "forked",
        });
      }

      const facts = yield* collectFacts(
        "fork-session",
        () => "review",
        true,
        entries,
        mode === "normal" ? undefined : "parent"
      ).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              HOME: dir,
              RATKING_CONFIG: config,
              RATKING_NAME: mode === "explicit" ? "project/worker" : "sb",
            })
          )
        )
      );

      const expected = {
        alias: { name: "switchboard/review", source: "forked" },
        explicit: { name: "project/worker", source: "env" },
        normal: { name: "sb", source: "env" },
        resume: { name: "switchboard/review", source: "restored" },
      }[mode];

      expect(facts.env).toEqual(Option.some(expected.name));
      expect(facts.source).toBe(expected.source);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
