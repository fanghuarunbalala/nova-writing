/** Compares tolerant and strict Scans at the last committed boundary. */
import type { MessageProjectionFileScan } from "../file/index.js";
import type { MessageProjectionSchemaCompatibility } from "./MessageProjectionMaintenancePlanner.js";

export class MessageProjectionSchemaInspector {
  inspect(
    structuralScan: MessageProjectionFileScan,
    strictScan: MessageProjectionFileScan,
  ): MessageProjectionSchemaCompatibility {
    const structuralHash = structuralScan.state?.committedRecordHash;
    const strictHash = strictScan.state?.committedRecordHash;
    if (structuralHash === undefined) return "not_applicable";
    return structuralHash === strictHash ? "compatible" : "unavailable";
  }
}
