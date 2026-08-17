import { defineConfig } from "evalite/config";

export default defineConfig({
	// agent 多 turn 长任务（evalite 缺省 30s 远不够）
	testTimeout: 600_000,
	// case 间并发 2（防限流，docs/PRD/eval-harness.md §7）
	maxConcurrency: 2,
});
