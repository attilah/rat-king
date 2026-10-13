import { NodeServices } from "@effect/platform-node";
import { settingsLayer } from "@rat-king/ratking-client/config";
import type { NotConfigured } from "@rat-king/ratking-client/config";
import { directoryLayer } from "@rat-king/ratking-client/directory";
import { issuerLayer } from "@rat-king/ratking-client/issuer";
import { Inbox, ratKingLayer } from "@rat-king/ratking-client/ratking";
import type { Attached } from "@rat-king/ratking-client/ratking";
import { secretStoreLayer } from "@rat-king/ratking-client/secrets";
import { Config, Context, Effect, Layer, Option } from "effect";
import { Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import { Usage } from "./faults.ts";
import type { Fault } from "./faults.ts";
import { emit, refuse } from "./output.ts";
import type { Report } from "./output.ts";

export const clientLayer = ratKingLayer.pipe(
  Layer.provideMerge(issuerLayer),
  Layer.provideMerge(secretStoreLayer),
  Layer.provideMerge(directoryLayer),
  Layer.provideMerge(settingsLayer),
  Layer.provideMerge(Layer.merge(NodeServices.layer, FetchHttpClient.layer))
);

export const toggle = (name: string) =>
  Flag.Boolean(name).pipe(Flag.withDefault(false));

export type ClientServices = Layer.Success<typeof clientLayer>;

export const Wiring = Context.Reference<
  Layer.Layer<ClientServices, NotConfigured>
>("ratking-cli/Wiring", { defaultValue: () => clientLayer });

export const commonFlags = {
  as: Flag.String("as").pipe(Flag.optional),
  json: toggle("json"),
};

export interface Common {
  readonly as: Option.Option<string>;
  readonly json: boolean;
}

export const resolveName = Effect.fn("RatkingCli.resolveName")(
  function* resolveName(as: Option.Option<string>) {
    if (Option.isSome(as)) {
      return as.value;
    }

    const env = yield* Config.option(Config.String("RATKING_NAME")).pipe(
      Effect.orElseSucceed(() => Option.none<string>())
    );

    if (Option.isSome(env)) {
      return env.value;
    }

    return yield* new Usage({
      accepted:
        "--as <name> for a name whose key this machine holds, or RATKING_NAME",
      fix: "ratking whoami --as <name>",
      reason: "No Rat King name: neither --as nor RATKING_NAME is set",
    });
  }
);

export const groundOf = (common: Common) => ({
  as: Option.getOrElse(common.as, () => "<name>"),
});

export const conclude = (
  command: string,
  common: Common,
  program: Effect.Effect<Report, Fault, ClientServices>
) =>
  Effect.gen(function* wired() {
    return yield* program.pipe(Effect.provide(yield* Wiring));
  }).pipe(
    Effect.matchEffect({
      onFailure: (fault) =>
        refuse(common.json, command, groundOf(common), fault),
      onSuccess: (report) => emit(common.json, command, report),
    })
  );

export const named = (
  command: string,
  common: Common,
  body: (me: Attached) => Effect.Effect<Report, Fault, ClientServices>
) =>
  conclude(
    command,
    common,
    Effect.gen(function* attachedName() {
      const inbox = yield* Inbox;
      const me = yield* inbox.attach(yield* resolveName(common.as));

      return yield* body(me);
    })
  );
