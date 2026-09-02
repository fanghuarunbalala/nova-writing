/** Makes explicitly injected platform capabilities available to shared components. */
import { createContext, useContext, type ReactNode } from "react";
import type { FrontendPlatform } from "./FrontendPlatform.js";

export interface FrontendPlatformProviderProps {
  readonly platform: FrontendPlatform;
  readonly children?: ReactNode;
}

const FrontendPlatformContext = createContext<FrontendPlatform | undefined>(
  undefined,
);

export function FrontendPlatformProvider({
  platform,
  children,
}: FrontendPlatformProviderProps) {
  return (
    <FrontendPlatformContext.Provider value={platform}>
      {children}
    </FrontendPlatformContext.Provider>
  );
}

export function useFrontendPlatform(): FrontendPlatform {
  const platform = useContext(FrontendPlatformContext);
  if (platform === undefined) {
    throw new Error("FrontendPlatformProvider is required");
  }
  return platform;
}
