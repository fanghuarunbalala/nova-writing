/**
 * 路由 hooks：把 router store 接入 React。
 */
import { useExternalStore } from "../state/useExternalStore.js";
import { type InspectorRouter, type InspectorSnapshot } from "./InspectorRouter.js";
import { type MainViewRouter, type MainViewSnapshot } from "./MainViewRouter.js";

export function useMainView(router: MainViewRouter): MainViewSnapshot {
  return useExternalStore(router);
}

export function useInspectorRoute(router: InspectorRouter): InspectorSnapshot {
  return useExternalStore(router);
}
