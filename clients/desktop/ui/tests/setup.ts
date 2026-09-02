/**
 * vitest 全局 setup：注入 jest-dom 匹配器（toBeInTheDocument 等）。
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
