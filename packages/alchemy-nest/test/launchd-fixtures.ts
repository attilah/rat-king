import { Effect } from "effect";

import { offlineLayer } from "../src/fake-shell.ts";
import { HostShell } from "../src/host-shell.ts";
import { launchdPath } from "../src/launchd-plist.ts";
import type { LaunchdProps } from "../src/launchd-plist.ts";

export const launchdFixture = {
  directory: "/srv/example/agents",
  environment: { EXAMPLE: "fixture" },
  label: "org.example.throwaway",
  labelPrefix: "org.example",
  programArguments: ["/usr/bin/yes", "fixture"],
  uid: 501,
  workingDirectory: "/srv/example",
} satisfies LaunchdProps;

export const makeLaunchdFake = Effect.fn("Test.launchd.fake")(function* make() {
  const base = yield* HostShell;
  yield* base.mkdir({ mode: 0o700, path: launchdFixture.directory });

  const services = new Map<
    string,
    { readonly pid: number; readonly path: string }
  >();

  const calls: string[] = [];
  let nextPid = 100;
  let readable = true;
  let stuckPid = false;

  const shell = {
    ...base,
    exec: Effect.fn("Test.launchctl")(function* exec(argv: readonly string[]) {
      if (argv[0] !== "/bin/launchctl") {
        return yield* base.exec(argv);
      }

      const action = argv[1] ?? "";
      const target = argv[2] ?? "";
      calls.push(action);

      if (!readable) {
        return { code: 1, stdout: "unreadable" };
      }

      if (action === "print") {
        if (/^gui\/\d+$/u.test(target)) {
          return { code: 0, stdout: "domain" };
        }

        const live = services.get(target);

        return live === undefined
          ? { code: 113, stdout: "" }
          : {
              code: 0,
              stdout: `state = running\npath = ${live.path}\npid = ${live.pid}\n`,
            };
      }

      if (action === "bootout") {
        services.delete(target);

        return { code: 0, stdout: "" };
      }

      if (action === "bootstrap") {
        const path = argv[3] ?? "";
        const label = path.slice(path.lastIndexOf("/") + 1, -".plist".length);

        if (!stuckPid) {
          nextPid += 1;
        }

        services.set(`${target}/${label}`, { path, pid: nextPid });

        return { code: 0, stdout: "" };
      }

      return { code: 1, stdout: "" };
    }),
  };

  return {
    calls,
    file: () => shell.read(launchdPath(launchdFixture)),
    foreign: () => {
      services.set(`gui/${launchdFixture.uid}/${launchdFixture.label}`, {
        path: "/srv/example/foreign.plist",
        pid: 99,
      });
    },
    shell,
    stuck: () => {
      stuckPid = true;
    },
    unreadable: () => {
      readable = false;
    },
  };
}, Effect.provide(offlineLayer));
