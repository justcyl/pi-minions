import type { AgentTree } from "./tree.js";

export const MINION_NAMES = [
  "kevin", "bob", "stuart", "dave", "jerry",
  "phil", "tim", "mark", "lance", "mel",
] as const;

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function pickMinionName(tree: AgentTree, fallbackId: string): string {
  const inUse = new Set(tree.getRunning().map((n) => n.name));
  const available = MINION_NAMES.filter((n) => !inUse.has(n));
  if (available.length === 0) return `minion-${fallbackId}`;
  return available[Math.floor(Math.random() * available.length)]!;
}
