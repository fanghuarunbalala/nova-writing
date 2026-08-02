/** Stable, redacted remote error shape; raw Error objects never cross a Transport. */
export const API_ERROR_CATEGORY = {
  validation: "validation",
  notFound: "not-found",
  conflict: "conflict",
  permission: "permission",
  unavailable: "unavailable",
  internal: "internal",
} as const;

export type ApiErrorCategory =
  (typeof API_ERROR_CATEGORY)[keyof typeof API_ERROR_CATEGORY];

export interface ApiErrorSnapshot {
  readonly code: string;
  readonly category: ApiErrorCategory;
  readonly retryable: boolean;
  readonly message: string;
}

export function isApiErrorCategory(value: unknown): value is ApiErrorCategory {
  return (
    typeof value === "string" &&
    Object.values(API_ERROR_CATEGORY).some((category) => category === value)
  );
}
