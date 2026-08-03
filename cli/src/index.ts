#!/usr/bin/env node

import { projectVision } from "@novel/core";
import { createRuntime } from "@novel/core";
import { createDefaultCliConfigurationBootstrap } from "./config/index.js";

const configuration = await createDefaultCliConfigurationBootstrap().load();
const runtime = createRuntime({ kind: "agent" });

console.log(`${projectVision.name}: ${projectVision.belief}`);
console.log(`runtime: ${runtime.describe()}`);
console.log(`locale: ${configuration.general.locale}`);
