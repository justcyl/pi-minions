# Configuration

> See also: [Reference](reference.md) · [Agents](agents.md)

pi-minions reads configuration from pi's settings files. Settings are merged: global settings provide defaults, project settings override.

## Settings files

| Location | Scope | Purpose |
|----------|-------|---------|
| `~/.pi/agent/settings.json` | Global | Default settings for all projects |
| `.pi/settings.json` | Project | Override global settings per repository |

The global settings path respects the `PI_CODING_AGENT_DIR` environment variable. If set, global settings are loaded from `$PI_CODING_AGENT_DIR/settings.json` instead.

## Configuration schema

Add a `pi-minions` key to your settings file:

```json
{
  "pi-minions": {
    "minionNames": ["kevin", "stuart", "bob"],
    "delegation": {
      "toolCallThreshold": 8,
      "hintIntervalMinutes": 8
    },
    "display": {
      "outputPreviewLines": 20,
      "observabilityLines": 6,
      "showStatusHints": true,
      "spinnerFrames": ["[oo]", "[o-]", "[--]", "[-o]"]
    }
  }
}
```

## Options reference

### minionNames

Array of names used when spawning ephemeral minions. Names are chosen randomly from available entries. When all names are in use, minions get numeric IDs like `minion-a1b2c3d4`.

| Default | Type |
|---------|------|
| 60 built-in names (kevin, stuart, bob...) | `string[]` |

### delegation.enabled

Enable or disable delegation reminders entirely.

| Default | Type |
|---------|------|
| true | `boolean` |

### delegation.toolCallThreshold

Number of tool calls before the delegation hint appears. The hint reminds you to use minions for parallel work.

| Default | Type | Range |
|---------|------|-------|
| 8 | `number` | 1-100 |

### delegation.hintIntervalMinutes

Minutes between delegation hints. Prevents hint spam during long sessions.

| Default | Type | Range |
|---------|------|-------|
| 8 | `number` | 1-120 |

### display.outputPreviewLines

Lines shown in expanded output preview for completed minions.

| Default | Type | Range |
|---------|------|-------|
| 20 | `number` | 1-100 |

### display.observabilityLines

Visible messages in the minion observability widget (`/minions show`).

| Default | Type | Range |
|---------|------|-------|
| 6 | `number` | 1-20 |

### display.showStatusHints

Show rotating command hints in the status bar when minions are running.

| Default | Type |
|---------|------|
| true | `boolean` |

### display.spinnerFrames

Animation frames for running minions. Each frame displays for 100ms.

| Default | Type |
|---------|------|
| `["[oo]", "[oo]", "[oo]", "[oo]", "[o-]", "[--]", "[--]", "[-o]", "[oo]", "[oo]"]` | `string[]` |

## Example configurations

### Minimal custom names

```json
{
  "pi-minions": {
    "minionNames": ["scout", "soldier", "pyro", "demo"]
  }
}
```

### Disable delegation hints

```json
{
  "pi-minions": {
    "delegation": {
      "enabled": false
    }
  }
}
```

### Braille spinner

```json
{
  "pi-minions": {
    "display": {
      "spinnerFrames": ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    }
  }
}
```

### Full customization

```json
{
  "pi-minions": {
    "minionNames": ["ares", "athena", "hermes", "hephaestus"],
    "delegation": {
      "enabled": true,
      "toolCallThreshold": 5,
      "hintIntervalMinutes": 15
    },
    "display": {
      "outputPreviewLines": 30,
      "observabilityLines": 8,
      "showStatusHints": false,
      "spinnerFrames": ["◐", "◓", "◑", "◒"]
    }
  }
}
```
