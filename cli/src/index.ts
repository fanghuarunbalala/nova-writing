#!/usr/bin/env node

import { projectVision } from "@novel/core";
import { createRuntime } from "@novel/core";

const runtime = createRuntime({ kind: "agent" });

console.log(`${projectVision.name}: ${projectVision.belief}`);
console.log(`runtime: ${runtime.describe()}`);
