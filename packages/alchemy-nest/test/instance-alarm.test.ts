import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Match, Ref, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { AlarmSettings } from "../../../stacks/nest/alarm-config.ts";
import { collectInstanceHealth } from "../../../stacks/nest/alarm-instances.ts";
import {
  emptySources,
  observeAlarms,
} from "../../../stacks/nest/alarm-sources.ts";
import type { AlarmFacts } from "../../../stacks/nest/alarm-sources.ts";
import { alarmCycle, emptyJournal } from "../../../stacks/nest/alarm.ts";
import type { AlarmPorts } from "../../../stacks/nest/alarm.ts";

const settings = Schema.decodeUnknownSync(AlarmSettings)({
  broadcast: "observer-invalid",
  enabled: false,
  instances: [
    {
      name: "instance-a",
      owner: "owner-a",
      versionUrl: "https://instance-a.invalid/.well-known/rat-king/version",
    },
    {
      name: "instance-b",
      owner: "owner-b",
      versionUrl: "https://instance-b.invalid/.well-known/rat-king/version",
    },
  ],
  launchd: {
    errorLog: "/fixture.invalid/err",
    label: "alarm.invalid",
    node: "node",
    outputLog: "/fixture.invalid/out",
    path: "/fixture.invalid/bin",
    source: "/fixture.invalid",
  },
  musterDesk: "desk-invalid",
  notify: {
    directory: "/fixture.invalid/directory.json",
    secret: "operator.invalid",
  },
  owners: { celld: "mailbox-owner", instance: "unrelated-owner" },
  page: { node: "node", script: "/fixture.invalid/page.mjs" },
});

const healthy: typeof AlarmFacts.Type = {
  cacheBreaches: [],
  deploy: null,
  deployKnown: true,
  digest: "ok",
  doctor: true,
  entered: null,
  health: 200,
  measurementFailed: false,
  quarantinedHour: 0,
  readers: null,
  receipts: [],
  receiptsKnown: true,
  slots: { free: 100, max: 100 },
};

it.effect.prop(
  "configured HTTP version probes warn only, route only down owners and preserve mailbox critical paging",
  {
    commit: Schema.String,
    status: Schema.Int.check(Schema.isBetween({ maximum: 599, minimum: 201 })),
    version: Schema.String,
  },
  ({ commit, status, version }) =>
    Effect.gen(function* probes() {
      const encoded = yield* Schema.encodeEffect(
        Schema.fromJsonString(AlarmSettings)
      )(settings);

      const decoded = yield* Schema.decodeEffect(
        Schema.fromJsonString(AlarmSettings)
      )(encoded);

      for (const mode of [
        "healthy",
        "status",
        "shape",
        "bootstrap",
        "transport",
        "both",
        "missing",
      ]) {
        const calls: string[] = [];

        const client = HttpClient.make((request) => {
          expect(request.method).toBe("GET");
          calls.push(request.url);

          const down =
            mode === "both" || request.url.includes("instance-a.invalid");

          if (down && mode === "transport") {
            return Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({ request }),
              })
            );
          }

          let body = JSON.stringify({ commit, version });

          if (down && mode === "shape") {
            body = JSON.stringify({ commit: 5, version: "example" });
          } else if (down && mode === "bootstrap") {
            body = "rat-king bootstrap";
          }

          const code =
            down && (mode === "status" || mode === "both") ? status : 200;

          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(code === 200 ? body : null, { status: code })
            )
          );
        });

        const instances = yield* collectInstanceHealth(
          mode === "missing" ? undefined : decoded.instances
        ).pipe(Effect.provideService(HttpClient.HttpClient, client));

        expect(calls.toSorted()).toEqual(
          mode === "missing"
            ? []
            : (decoded.instances ?? [])
                .map((instance) => instance.versionUrl)
                .toSorted()
        );

        const expectedDown = ["instance-a", "instance-b"].filter(
          (name) =>
            !["healthy", "missing"].includes(mode) &&
            (mode === "both" || name === "instance-a")
        );

        expect(
          instances
            .filter((instance) => instance.status === "down")
            .map((instance) => instance.name)
        ).toEqual(expectedDown);
        const facts = { ...healthy, instances };

        const reading = observeAlarms(emptySources, facts, 1000).readings[
          "instance.down"
        ];

        const recipients: {
          key: string;
          recipients: readonly string[];
          text: string;
        }[] = [];

        const pages: string[] = [];

        const ports: AlarmPorts<never> = {
          page: (text) =>
            Effect.sync(() => {
              pages.push(text);
            }),
          prepare: (key, targets, text) =>
            Effect.sync(() => {
              recipients.push({ key, recipients: targets, text });

              return [];
            }),
          save: () => Effect.void,
          send: () => Effect.die("empty test preparation sends nothing"),
          unavailable: Effect.die("test ports are available"),
        };

        yield* alarmCycle(emptyJournal, facts, 1000, decoded, ports);
        expect(pages).toEqual([]);

        if (expectedDown.length === 0) {
          expect(reading.status).toBe("ok");
          expect(recipients).toEqual([]);
        } else {
          expect(reading.status).toBe("firing");
          expect(recipients).toHaveLength(1);
          expect(recipients[0]?.recipients.toSorted()).toEqual(
            [
              "observer-invalid",
              ...expectedDown.map((name) =>
                name === "instance-a" ? "owner-a" : "owner-b"
              ),
            ].toSorted()
          );

          if (reading.status === "firing") {
            expect(reading.severity).toBe("warn");

            for (const name of expectedDown) {
              expect(reading.evidence).toContain(name);
            }

            expect(reading.evidence).toContain(
              Match.value(mode).pipe(
                Match.when("transport", () => "transport error"),
                Match.when("shape", () => "invalid version response"),
                Match.when("bootstrap", () => "invalid version response"),
                Match.orElse(() => `HTTP ${status}`)
              )
            );
            expect(reading.evidence).not.toContain("https://");
          }
        }

        recipients.length = 0;

        const first = yield* alarmCycle(
          emptyJournal,
          { ...facts, health: 503 },
          2000,
          decoded,
          ports
        );

        yield* alarmCycle(
          first,
          { ...facts, health: 503 },
          3000,
          decoded,
          ports
        );
        expect(pages).toHaveLength(1);
        expect(pages[0]).toContain(
          "celld.down critical: Mailbox health is unavailable"
        );

        const mailbox = recipients.find(
          (notice) => notice.key === "celld.down"
        );

        expect(mailbox?.recipients.toSorted()).toEqual([
          "mailbox-owner",
          "observer-invalid",
        ]);
      }
    })
);

it.effect.prop(
  "instance probe timeout cancels the request and records a warning reason",
  { name: Schema.NonEmptyString },
  ({ name }) =>
    Effect.gen(function* timeout() {
      const started = yield* Deferred.make<boolean>();
      const cancelled = yield* Ref.make(false);

      const client = HttpClient.make(() =>
        Deferred.succeed(started, true).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Ref.set(cancelled, true))
        )
      );

      const fiber = yield* collectInstanceHealth([
        {
          name,
          owner: "owner-a",
          versionUrl: "https://timeout.invalid/version",
        },
      ]).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.forkScoped
      );

      yield* Deferred.await(started);
      yield* TestClock.adjust("31 seconds");
      const instances = yield* Fiber.join(fiber);
      expect(instances).toEqual([
        { name, reason: "probe timed out", status: "down" },
      ]);
      expect(yield* Ref.get(cancelled)).toBe(true);

      const reading = observeAlarms(
        emptySources,
        { ...healthy, instances },
        1000
      ).readings["instance.down"];

      expect(reading.status === "firing" && reading.severity).toBe("warn");
    })
);
