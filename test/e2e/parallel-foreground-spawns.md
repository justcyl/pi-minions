# Test: parallel-foreground-spawns

Verify that multiple foreground `spawn` calls in a single response execute in parallel.

## Setup

```bash
rm -f /tmp/logs/pi-minions/minions/*.log 2>/dev/null
rm -f /tmp/logs/pi-minions/debug.log 2>/dev/null
```

## Action

Spawn 2 `e2e-timeout` foreground minions in parallel. Give each minion the task: `Say hello, then use the bash tool to run sleep 60`.

After both complete, run:
```bash
grep -E "spawn:tool.*(start|completed|failed)" /tmp/logs/pi-minions/debug.log
```

## Expected

- Both spawn calls returned (transcript files for both minions exist under `/tmp/logs/pi-minions/minions/`)
- Each transcript contains `hello` (said before the sleep)
- The debug log contains two `spawn:tool.*start` lines both appearing before any `spawn:tool.*completed` or `spawn:tool.*failed` line — confirming concurrent start

## Cleanup

None.
