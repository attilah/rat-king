import { createMachine } from "xstate";

export const launchdLifecycle = createMachine({
  context: {},
  id: "launchd-reconcile",
  initial: "inspect",
  states: {
    bootout: { on: { DONE: { target: "bootstrap" } } },
    bootstrap: { on: { DONE: { target: "verify" } } },
    inspect: {
      on: {
        CHANGE_RUNNING: { target: "writeChanged" },
        CHANGE_STOPPED: { target: "writeNew" },
        CREATE: { target: "writeNew" },
        MATCH_RUNNING: { target: "verify" },
        MATCH_STOPPED: { target: "bootstrap" },
      },
    },
    ready: { type: "final" },
    verify: { on: { DONE: { target: "ready" } } },
    writeChanged: { on: { DONE: { target: "bootout" } } },
    writeNew: { on: { DONE: { target: "bootstrap" } } },
  },
});
