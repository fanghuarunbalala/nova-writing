/** Compile-only proof for project-section navigation and Shell callbacks. */
import {
  ApplicationShellStore,
  InspectorStore,
  ProjectNavigationController,
  type ProjectNavigationItem,
} from "../src/index.js";

const shellStore = new ApplicationShellStore({
  novel: { id: "novel-1", label: "星海纪元" },
});
const inspectorStore = new InspectorStore();
const controller = new ProjectNavigationController({ shellStore, inspectorStore });
const item: ProjectNavigationItem = "outline";
const result = controller.navigate(item);

void result;
