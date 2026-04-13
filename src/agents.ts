import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";
import type { AgentConfig, AgentSource, ThinkingLevel } from "./types.js";

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

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

    const steps =
      frontmatter.steps || frontmatter.max_turns
        ? parseInt(frontmatter.steps, 10) || parseInt(frontmatter.max_turns, 10) || undefined
        : undefined;
    const timeout = frontmatter.timeout
      ? parseInt(frontmatter.timeout, 10) || undefined
      : undefined;

    agents.push({
      name,
      displayName: frontmatter.displayName,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      thinking,
      steps,
      timeout,
      systemPrompt: body.trim(),
      source,
      filePath,
    });
  }

  return agents;
}

function findProjectDir(cwd: string, ...subpath: string[]): string | null {
  let current = cwd;
  while (true) {
    const candidate = join(current, ...subpath);
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

  // Global dirs: ~/.pi/agent/agents/, ~/.pi/agent/minions/, ~/.agents/agents/, ~/.agents/minions/
  const userDir = join(agentDir, "agents");
  const minionsDir = join(agentDir, "minions");
  const dotAgentsUserDir = join(homedir(), ".agents", "agents");
  const dotMinionsUserDir = join(homedir(), ".agents", "minions");

  // Project dirs: .pi/agents/, .agents/agents/ (walk up to git root)
  const piProjectDir = findProjectDir(cwd, ".pi", "agents");
  const piMinionsProjectDir = findProjectDir(cwd, ".pi", "minions");
  const dotAgentsProjectDir = findProjectDir(cwd, ".agents", "agents");
  const dotMinionsProjectDir = findProjectDir(cwd, ".agents", "minions");

  const userAgents =
    scope !== "project"
      ? [
          ...loadAgentsFromDir(userDir, "user"),
          ...loadAgentsFromDir(minionsDir, "user"),
          ...loadAgentsFromDir(dotAgentsUserDir, "user"),
          ...loadAgentsFromDir(dotMinionsUserDir, "user"),
        ]
      : [];

  const projectAgents: AgentConfig[] = [];
  if (scope !== "user") {
    if (piProjectDir) projectAgents.push(...loadAgentsFromDir(piProjectDir, "project"));
    if (piMinionsProjectDir)
      projectAgents.push(...loadAgentsFromDir(piMinionsProjectDir, "project"));
    if (dotAgentsProjectDir)
      projectAgents.push(...loadAgentsFromDir(dotAgentsProjectDir, "project"));
    if (dotMinionsProjectDir)
      projectAgents.push(...loadAgentsFromDir(dotMinionsProjectDir, "project"));
  }

  // Build map: package (lowest) < user < project (highest)
  const packageAgentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "agents");
  const packageAgents = scope !== "project" ? loadAgentsFromDir(packageAgentsDir, "user") : [];

  const agentMap = new Map<string, AgentConfig>();
  for (const a of packageAgents) agentMap.set(a.name, a);
  for (const a of userAgents) agentMap.set(a.name, a);
  for (const a of projectAgents) agentMap.set(a.name, a);

  const projectAgentsDir =
    piProjectDir ?? dotAgentsProjectDir ?? piMinionsProjectDir ?? dotMinionsProjectDir;
  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}
