/**
 * Icon 组件测试：渲染 svg 与尺寸类名。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Settings } from "lucide-react";
import { Icon } from "../../src/shared/primitives/Icon.js";

describe("Icon", () => {
  it("renders an svg with size and color classes", () => {
    const { container } = render(<Icon icon={Settings} size="lg" color="accent" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class")).toContain("lg");
    expect(svg?.getAttribute("class")).toContain("accent");
  });
});
