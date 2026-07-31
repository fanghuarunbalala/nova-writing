export function generateEventId(): string {
  return `evt_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
