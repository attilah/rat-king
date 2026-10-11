import { createMachine } from "xstate";

export const drainMachine = createMachine({
  context: {},
  id: "nest-drain",
  initial: "reading",
  states: {
    acking: { on: { DONE: { target: "finished" } } },
    finished: { type: "final" },
    pending: {
      on: { DONE: { target: "finished" }, EXEC: { target: "processing" } },
    },
    processing: {
      on: { FAILURE: { target: "finished" }, SUCCESS: { target: "acking" } },
    },
    reading: {
      on: { ACK: { target: "acking" }, PRINTED: { target: "pending" } },
    },
  },
});
