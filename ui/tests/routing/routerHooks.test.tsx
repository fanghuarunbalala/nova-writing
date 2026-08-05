/**
 * 路由 hooks 组件测试：快照读取与变更重渲染。
 */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { InspectorRouter } from "../../src/shared/routing/InspectorRouter.js";
import { MainViewRouter } from "../../src/shared/routing/MainViewRouter.js";
import { useInspectorRoute, useMainView } from "../../src/shared/routing/hooks.js";

function MainViewProbe({ router }: { readonly router: MainViewRouter }) {
  const snapshot = useMainView(router);
  return <output>{snapshot.state}</output>;
}

function InspectorProbe({ router }: { readonly router: InspectorRouter }) {
  const snapshot = useInspectorRoute(router);
  return <output>{snapshot.state.kind}</output>;
}

describe("routing hooks", () => {
  it("useMainView renders and follows the router", () => {
    const router = new MainViewRouter();
    render(<MainViewProbe router={router} />);
    expect(screen.getByRole("status")).toHaveTextContent("chat");
    act(() => router.transition("content"));
    expect(screen.getByRole("status")).toHaveTextContent("content");
  });

  it("useInspectorRoute renders and follows the router", () => {
    const router = new InspectorRouter();
    render(<InspectorProbe router={router} />);
    expect(screen.getByRole("status")).toHaveTextContent("closed");
    act(() => router.transition({ kind: "approval", changeSetId: "CS-1" }));
    expect(screen.getByRole("status")).toHaveTextContent("approval");
  });
});
