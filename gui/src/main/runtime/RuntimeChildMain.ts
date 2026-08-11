/** Production desktop child process main: default Runtime composition. */
import { appendFileSync } from "node:fs";
import { runDesktopRuntimeChildEntrypoint } from "@novel/core/node";

// 崩溃自曝：未捕获异常/拒绝会被 Node 默认打印到 stderr，而父进程此前只统计
// stderr 字节数、从不落盘（RuntimeChildProcessLauncher），根因因此不可见。
// 这里在一切逻辑之前同步把完整堆栈写入 runtime-child.log（appendFileSync 在
// process.exit 前必达盘，fire-and-forget 的 async appendFile 会随 exit 丢失），
// 同时回写 stderr 供父进程新埋点捕获，然后以原崩溃语义退出（code 1）。
// Crash visibility: uncaught exceptions/rejections are printed to stderr, which
// the parent only counted (never persisted), so the root cause was invisible.
// Register before any other logic: sync-write the full stack to the child log
// (appendFileSync is flushed before process.exit; the fire-and-forget async
// appendFile would be lost on exit), also re-echo to stderr for the parent's
// new capture, then exit(1) preserving the original crash semantics.
const CHILD_LOG_ENV = "NOVEL_DESKTOP_CHILD_LOG" as const;
const childLogPath = process.env[CHILD_LOG_ENV];

function writeCrashTrace(line: string): void {
  // 父进程 stderr 转发埋点（runtime.process.child_stderr）也会捕获这份内容。
  console.error(line);
  if (childLogPath === undefined || childLogPath.length === 0) return;
  try {
    appendFileSync(childLogPath, `${line}\n`);
  } catch {
    // console.error 已兜底；日志路径不可写不应掩盖崩溃本身。
  }
}

function describeCrash(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.stack ?? `${reason.name}: ${reason.message}`;
  }
  return `unknown crash reason: ${String(reason)}`;
}

process.on("uncaughtException", (error) => {
  writeCrashTrace(`CRASH uncaughtException\n${describeCrash(error)}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  writeCrashTrace(`CRASH unhandledRejection\n${describeCrash(reason)}`);
  process.exit(1);
});

await runDesktopRuntimeChildEntrypoint();
