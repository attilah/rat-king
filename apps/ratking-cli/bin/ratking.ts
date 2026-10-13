#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";

import { main } from "../src/main.ts";

NodeRuntime.runMain(main(process.argv.slice(2)));
