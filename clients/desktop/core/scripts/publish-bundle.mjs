/**
 * 定义包发布脚本（定义包-端侧迁移 PRD FR5）：
 *
 *   pnpm -C core run bundle:publish -- [--version 1.6.0] [--server http://127.0.0.1:8787]
 *
 * - 读取 golden 包 fixtures/definition-novel-1.5.0.json；
 * - --version 指定新版本号（改了策略面重新生成 golden 后 bump 发布；缺省用包内版本号）；
 * - 登录（NOVA_ADMIN_USER / NOVA_ADMIN_PASS 环境变量）取 JWT，POST /v1/definitions；
 * - 同版本已存在会 409（不可变），换新版本号重发。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const versionArg = args.includes("--version") ? args[args.indexOf("--version") + 1] : undefined;
const serverArg = args.includes("--server") ? args[args.indexOf("--server") + 1] : undefined;
const server = serverArg ?? process.env.NOVA_SERVER_URL ?? "http://127.0.0.1:8787";
const user = process.env.NOVA_ADMIN_USER;
const pass = process.env.NOVA_ADMIN_PASS;
if (!user || !pass) {
  console.error("需要 NOVA_ADMIN_USER / NOVA_ADMIN_PASS 环境变量");
  process.exit(1);
}

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "protocol",
  "fixtures",
  "definition-novel-1.5.0.json",
);
const bundle = JSON.parse(readFileSync(fixturePath, "utf8"));
if (versionArg) bundle.definitionVersion = versionArg;
console.log(`发布定义包 ${bundle.definitionVersion} → ${server}`);

const loginRes = await fetch(`${server}/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: user, password: pass, deviceName: "bundle-publisher" }),
});
if (!loginRes.ok) {
  console.error(`登录失败: ${loginRes.status} ${await loginRes.text()}`);
  process.exit(1);
}
const { accessToken } = await loginRes.json();

const upRes = await fetch(`${server}/v1/definitions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
  body: JSON.stringify(bundle),
});
if (upRes.status === 201) {
  console.log(`✅ 已发布 ${bundle.definitionVersion}`);
} else if (upRes.status === 409) {
  console.error(`⚠️ ${bundle.definitionVersion} 已存在（不可变）——改策略后请 bump 版本号重发`);
  process.exit(2);
} else {
  console.error(`发布失败: ${upRes.status} ${await upRes.text()}`);
  process.exit(1);
}
