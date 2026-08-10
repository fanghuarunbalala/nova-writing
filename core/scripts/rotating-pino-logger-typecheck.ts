import type { Logger } from "../src/index.js";
import {
  createPinoLogger,
  createRotatingFileLogger,
} from "../src/node/observability/index.js";

const rotating: Logger = createRotatingFileLogger({
  file: "/tmp/novel-test.log",
  level: "verbose",
  retentionCount: 7,
});
const plain: Logger = createPinoLogger({ level: "debug" });
void rotating;
void plain;
void rotating.flush;
void rotating.child({ workspaceId: "ws-1", workspaceName: "name" }).info(
  "event",
  {},
);
void plain.verbose?.("event", {});
