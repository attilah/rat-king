import { Resource } from "alchemy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Effect } from "effect";

import { absent } from "./absent.ts";
import { readFile, refuse } from "./files.ts";
import { HostShell } from "./host-shell.ts";
import { launchdPath, plistDigest } from "./launchd-plist.ts";
import type { LaunchdProps } from "./launchd-plist.ts";
import {
  assertOwnership,
  deleteLaunchd,
  readLaunchd,
  reconcileLaunchd,
  validateLaunchd,
} from "./launchd.ts";
import type { LaunchdAttributes } from "./launchd.ts";

export type LaunchdServiceResource = Resource<
  "Darwin.LaunchdService",
  LaunchdProps,
  LaunchdAttributes
>;

export const LaunchdService = Resource<LaunchdServiceResource>(
  "Darwin.LaunchdService"
);

export const LaunchdServiceProvider = () =>
  Provider.effect(
    LaunchdService,
    Effect.gen(function* provider() {
      const shell = yield* HostShell;

      return LaunchdService.Provider.of({
        delete: ({ output }) =>
          output === undefined ? Effect.void : deleteLaunchd(shell, output),
        diff: Effect.fn("Launchd.provider.diff")(function* diff({
          news,
          output,
        }) {
          if (!isResolved(news)) {
            return absent;
          }

          yield* validateLaunchd(news);

          if (output === undefined) {
            yield* assertOwnership(shell, news);

            return { action: "update" };
          }

          if (
            output.path !== launchdPath(news) ||
            output.uid !== news.uid ||
            output.label !== news.label ||
            output.labelPrefix !== news.labelPrefix
          ) {
            return yield* refuse(
              "LaunchAgent identity changes require a new resource."
            );
          }

          const file = yield* readFile(shell, output.path);

          if (file?.sha256 !== output.sha256 || file.mode !== 0o600) {
            return yield* refuse("LaunchAgent plist custody was lost.");
          }

          const live = yield* readLaunchd(shell, news);

          return {
            action:
              file.sha256 === plistDigest(news) &&
              live !== undefined &&
              output.deleteOnRemove === (news.deleteOnRemove === true)
                ? "noop"
                : "update",
          };
        }),
        list: () => Effect.succeed([]),
        read: Effect.fn("Launchd.provider.read")(function* read({
          olds,
          output,
        }) {
          if (output === undefined) {
            return absent;
          }

          yield* validateLaunchd(olds);
          const file = yield* readFile(shell, output.path);

          if (file?.sha256 !== output.sha256 || file.mode !== 0o600) {
            return yield* refuse("LaunchAgent plist custody was lost.");
          }

          const live = yield* readLaunchd(shell, olds);

          return { ...output, pid: live?.pid ?? 0 };
        }),
        reconcile: ({ news, output }) => reconcileLaunchd(shell, news, output),
      });
    })
  );

export const Darwin = { LaunchdService, LaunchdServiceProvider };
