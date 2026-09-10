// conversation 子进程入口：装配 Conversation + stdio transport（node 宿主）。
// provider 配置经 env（NOVEL_PROVIDER_*）注入；config 域落地后改经 config 传递。
import { runDesktopRuntimeChildEntrypoint } from "../dist/node/runtime/runDesktopRuntimeChildEntrypoint.js";

await runDesktopRuntimeChildEntrypoint();
