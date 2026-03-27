import type { AgentNode, AgentStatus, UsageStats } from "./types.js";
import { emptyUsage } from "./types.js";

export class AgentTree {
  private nodes = new Map<string, AgentNode>();

  add(id: string, name: string, task: string, parentId?: string): AgentNode {
    const node: AgentNode = {
      id,
      name,
      task,
      status: "running",
      parentId,
      children: [],
      usage: emptyUsage(),
      startTime: Date.now(),
    };
    this.nodes.set(id, node);

    if (parentId) {
      const parent = this.nodes.get(parentId);
      if (parent) parent.children.push(id);
    }

    return node;
  }

  get(id: string): AgentNode | undefined {
    return this.nodes.get(id);
  }

  getRunning(): AgentNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.status === "running");
  }

  getRoots(): AgentNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.parentId === undefined);
  }

  getDepth(id: string): number {
    const node = this.nodes.get(id);
    if (!node) return 0;
    let depth = 0;
    let current = node;
    while (current.parentId) {
      const parent = this.nodes.get(current.parentId);
      if (!parent) break;
      depth++;
      current = parent;
    }
    return depth;
  }

  updateStatus(id: string, status: AgentStatus, exitCode?: number, error?: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = status;
    if (exitCode !== undefined) node.exitCode = exitCode;
    if (error !== undefined) node.error = error;
    if (status !== "running" && status !== "pending") node.endTime = Date.now();
  }

  updateUsage(id: string, partial: Partial<UsageStats>): void {
    const node = this.nodes.get(id);
    if (!node) return;
    Object.assign(node.usage, partial);
  }

  remove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    // Remove children recursively first
    for (const childId of [...node.children]) {
      this.remove(childId);
    }

    // Remove from parent's children list
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) {
        parent.children = parent.children.filter((c) => c !== id);
      }
    }

    this.nodes.delete(id);
  }
}
