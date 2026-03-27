import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";
import type { AgentConfig, AgentSource, ThinkingLevel } from "./types.js";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

export function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
  if (!existsSync(dir)) return [];

  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return [];
  }

  const agents: AgentConfig[] = [];

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = join(dir, entry.name);
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);

    if (!frontmatter.description) continue;

    const name = frontmatter.name ?? entry.name.replace(/\.md$/, "");

    const tools = frontmatter.tools
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const thinking =
      frontmatter.thinking && THINKING_LEVELS.has(frontmatter.thinking as ThinkingLevel)
        ? (frontmatter.thinking as ThinkingLevel)
        : undefined;

    const maxTurns = frontmatter.max_turns ? parseInt(frontmatter.max_turns, 10) || undefined : undefined;

    agents.push({
      name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      thinking,
      maxTurns,
      systemPrompt: body.trim(),
      source,
      filePath,
    });
  }

  return agents;
}

function findProjectAgentsDir(cwd: string): string | null {
  let current = cwd;
  while (true) {
    const candidate = join(current, ".pi", "agents");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;

    // Stop at git root
    if (existsSync(join(current, ".git"))) return null;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function discoverAgents(
  cwd: string,
  scope: "user" | "project" | "both",
): { agents: AgentConfig[]; projectAgentsDir: string | null } {
  const agentDir = getAgentDir();
  const userDir = join(agentDir, "agents");
  const minionsDir = join(agentDir, "minions");
  const projectAgentsDir = findProjectAgentsDir(cwd);

  const userAgents = scope !== "project"
    ? [...loadAgentsFromDir(userDir, "user"), ...loadAgentsFromDir(minionsDir, "user")]
    : [];
  const projectAgents = scope !== "user" && projectAgentsDir ? loadAgentsFromDir(projectAgentsDir, "project") : [];

  // Build map: project overrides user on same name
  const agentMap = new Map<string, AgentConfig>();
  for (const a of userAgents) agentMap.set(a.name, a);
  for (const a of projectAgents) agentMap.set(a.name, a);

  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}
