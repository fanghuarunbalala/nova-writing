import { homedir } from "node:os";
import { relative, sep } from "node:path";
import type {
  WorkspaceStoreNamingInput,
  WorkspaceStoreNamingStrategy,
} from "../../storage/workspace/index.js";

export interface SemanticWorkspaceStoreNamingOptions {
  maxSegments?: number;
  maxSegmentLength?: number;
  maxSlugLength?: number;
}

export class SemanticWorkspaceStoreNamingStrategy implements WorkspaceStoreNamingStrategy {
  private readonly maxSegments: number;
  private readonly maxSegmentLength: number;
  private readonly maxSlugLength: number;

  constructor(options: SemanticWorkspaceStoreNamingOptions = {}) {
    this.maxSegments = options.maxSegments ?? 3;
    this.maxSegmentLength = options.maxSegmentLength ?? 32;
    this.maxSlugLength = options.maxSlugLength ?? 96;
  }

  createStoreDirName(input: WorkspaceStoreNamingInput): string {
    const relativeToHome = relative(homedir(), input.canonicalWorkspaceRoot);
    const semanticPath = relativeToHome.startsWith(`..${sep}`)
      ? input.canonicalWorkspaceRoot
      : relativeToHome;
    const segments = semanticPath
      .split(/[\\/]+/u)
      .filter(Boolean)
      .slice(-this.maxSegments)
      .map((segment) => this.slugifySegment(segment))
      .filter(Boolean);
    const semanticSlug = this.truncateCodePoints(
      segments.join("-") || "workspace",
      this.maxSlugLength,
    ).replace(/-+$/u, "");
    const shortWorkspaceId = input.workspaceId.replace(/^ws-/u, "").replace(/-/gu, "").slice(0, 8);

    return `${semanticSlug || "workspace"}--${shortWorkspaceId}`;
  }

  private slugifySegment(segment: string): string {
    const normalized = segment
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/gu, "");

    return this.truncateCodePoints(normalized, this.maxSegmentLength).replace(/-+$/u, "");
  }

  private truncateCodePoints(value: string, maximumLength: number): string {
    return Array.from(value).slice(0, maximumLength).join("");
  }
}
