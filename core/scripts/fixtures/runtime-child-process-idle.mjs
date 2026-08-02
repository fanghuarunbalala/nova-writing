process.stderr.write("DO_NOT_CAPTURE_RUNTIME_CHILD_STDERR\n");
process.stdin.resume();
process.stdin.once("end", () => {
  process.exitCode = 0;
});
