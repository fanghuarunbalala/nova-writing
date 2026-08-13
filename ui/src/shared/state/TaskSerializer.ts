/**
 * TaskSerializer
 *
 * 异步任务串行器。保证同一资源的多个 UI 命令不会并发执行。
 * 用法：const serializer = new TaskSerializer();
 *       serializer.run(async () => { ... });
 */
export class TaskSerializer {
  private chain: Promise<unknown> = Promise.resolve();

  /** 将 task 排队执行；返回 task 的 Promise。 */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => task());
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result as Promise<T>;
  }

  /** 重置链（不取消正在执行的任务）。 */
  clear(): void {
    this.chain = Promise.resolve();
  }
}
