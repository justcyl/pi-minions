# Contributing

> See also: [E2E testing](e2e-testing.md) · [Architecture](architecture.md)

## Development setup

### Prerequisites

- **Node.js** (ES2022+ target)
- **pi** — `npm install -g @mariozechner/pi-coding-agent`
- **go-task** — [taskfile.dev](https://taskfile.dev/) (task runner)

### Getting started

```bash
git clone https://github.com/kalindudc/pi-minions.git
cd pi-minions
task up        # install deps + verify toolchain
```

### Task commands

| Command | Purpose |
|---------|---------|
| `task up` | Install dependencies, verify toolchain |
| `task dev` | Load extension into pi (with debug logging) |
| `task test` | Run unit tests (vitest) |
| `task typecheck` | TypeScript type check (`tsc --noEmit`) |
| `task test:e2e` | Run e2e tests against real pi + LLM |
| `task test:e2e -- <filter>` | Run filtered e2e tests (substring match) |

> [!TIP]
> Run `task dev` in one terminal and `task logs` in another to see debug output in real time.

## Project structure

```
src/
  index.ts           # Extension entry point — registers tools + commands
  tree.ts            # AgentTree — minion hierarchy tracking
  queue.ts           # ResultQueue — background result delivery
  spawn.ts           # runMinionSession — in-process session runner
  minions.ts         # Minion names, IDs, default prompt
  agents.ts          # Agent discovery + frontmatter parsing
  render.ts          # TUI rendering for spawn calls
  logger.ts          # Structured debug logging
  types.ts           # Shared TypeScript types
  tools/             # LLM-callable tool implementations
  commands/          # User command handlers (/spawn, /minions, /halt)
test/
  *.test.ts          # Unit tests (vitest)
  fixtures/          # Test fixtures (agent files, etc.)
  e2e/               # E2E test markdown files
docs/                # Documentation
.pi/
  agents/            # Project-local test agents (e2e-*)
  skills/            # Skills (e2e-runner)
scripts/
  e2e.sh             # E2E test runner script
  release.sh         # Release automation
tmp/                 # Gitignored — logs, plans, research
```

See [Architecture](architecture.md) for the module dependency map and data flow diagrams.

## Testing

### Unit tests

```bash
task test                    # run all
npx vitest run test/tree     # run specific file
npx vitest --watch           # watch mode
```

Tests use [vitest](https://vitest.dev/) with the `mock-session` helper for session testing. Assertions follow the pattern: set up fixtures, call the function, assert against return values or side effects.

### E2E tests

```bash
task test:e2e                # run all
task test:e2e -- halt        # run filtered (substring match)
```

E2E tests are agentic — a real LLM inside pi executes test markdown files. They test the full stack from extension loading through to transcript logging and safety controls.

See [E2E testing](e2e-testing.md) for the full guide on writing and running e2e tests.

## Code conventions

- **TypeScript strict** — `tsc --noEmit` must pass cleanly
- **vitest** for all unit tests
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, etc.
- Types are documentation — no JSDoc comments on typed functions
- Flat `docs/` directory — no nested subdirectories
- Short paragraphs in docs (2-3 sentences max)

## Documentation

Documentation follows the [Diátaxis framework](https://documentation.divio.com/):

| Quadrant | File | Purpose |
|----------|------|---------|
| Tutorial | `docs/getting-started.md` | Learning: hands-on walkthrough |
| How-to | `docs/patterns.md`, `docs/agents.md` | Problem-oriented recipes |
| Reference | `docs/reference.md` | Facts: schemas, types, config |
| Explanation | `docs/architecture.md` | Understanding: why it works this way |

**Key rules:**
- Each concept lives in exactly one file — cross-reference, never duplicate
- Verify all code references against source before writing
- Use GitHub-flavored markdown callouts (`> [!TIP]`, `> [!NOTE]`, `> [!WARNING]`)
- Sentence case headings, backticks for code/paths
