/** Runs the complete shared UI, Desktop, and Web contract validation matrix. */
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectories = ["ui", "gui", "web"];
const typechecks = [];
const smokes = [];

for (const packageDirectory of packageDirectories) {
  const scriptsDirectory = resolve(repositoryRoot, packageDirectory, "scripts");
  const entries = (await readdir(scriptsDirectory)).sort();
  for (const entry of entries) {
    const relativePath = `${packageDirectory}/scripts/${entry}`;
    if (/-typecheck\.(?:ts|tsx)$/.test(entry)) typechecks.push(relativePath);
    if (/-smoke\.mjs$/.test(entry)) smokes.push(relativePath);
  }
}

if (typechecks.length === 0 || smokes.length === 0) {
  throw new Error("GUI/Web validation matrix is empty");
}

await run("pnpm", ["build"], "build");
await run(
  "pnpm",
  [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--jsx",
    "react-jsx",
    "--skipLibCheck",
    ...typechecks,
  ],
  "typecheck",
);

for (const smoke of smokes) {
  await run("node", [smoke], smoke);
}

console.info("gui web validation passed", {
  typecheckCount: typechecks.length,
  smokeCount: smokes.length,
});

function run(command, args, label) {
  console.info("gui web validation step", { label });
  return new Promise((resolveStep, rejectStep) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
    child.once("error", () => {
      rejectStep(new Error(`GUI/Web validation step failed to start: ${label}`));
    });
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) {
        resolveStep();
        return;
      }
      rejectStep(new Error(`GUI/Web validation step failed: ${label}`));
    });
  });
}
