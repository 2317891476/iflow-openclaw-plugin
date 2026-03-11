---
name: iFlow Orchestration
description: Skill for orchestrating iFlow sessions from OpenClaw. Covers launching, monitoring, multi-turn interaction, lifecycle management, notifications, and parallel work patterns.
metadata: {"openclaw": {"requires": {"plugins": ["openclaw-iflow-plugin"]}}}
---

# iFlow Orchestration

You orchestrate iFlow sessions via the `openclaw-iflow-plugin`. Each session is an autonomous AI agent that executes tasks in the background.

---

## 1. Launching sessions

### Mandatory rules

- **Notifications are routed automatically** via `agentChannels` config. Do NOT pass `channel` manually — it bypasses automatic routing.
- **Always pass `multi_turn: true`** unless the task is a guaranteed one-shot with no possible follow-up.
- **Name the sessions** with `name` in kebab-case, short and descriptive.
- **Set `workdir`** to the target project directory, not the agent's workspace.

### Essential parameters

| Parameter | Type | When to use |
|---|---|---|
| `prompt` | string | Always. Clear and complete instruction. |
| `name` | string | Always. Descriptive kebab-case (`fix-auth-bug`, `add-dark-mode`). Auto-generated if omitted. |
| `workdir` | string | Always when the project is not in the `defaultWorkdir`. |
| `multi_turn_disabled` | boolean | Set to `true` only for fire-and-forget one-shot tasks. Default: `false` (multi-turn enabled). |
| `permission_mode` | string | `"auto"` / `"manual"` / `"selective"`. Defaults to plugin config or `"auto"`. |
| `system_prompt` | string | To inject project-specific context. |
| `timeout` | number | Session timeout in milliseconds (default: 300000 = 5min). |
| `max_turns` | number | Maximum number of turns before session ends. |
| `allowed_tools` | string[] | List of tool types to auto-approve. |
| `model` | string | Model name to use (passed to iFlow). |

### Examples

```
# Simple task (multi-turn, stays open for follow-up)
iflow_launch(
  prompt: "Fix the null pointer in src/auth.ts line 42",
  name: "fix-null-auth",
  workdir: "/home/user/projects/myapp"
)

# Full feature
iflow_launch(
  prompt: "Implement dark mode toggle in the settings page. Use the existing theme context in src/context/theme.tsx. Add a toggle switch component and persist the preference in localStorage.",
  name: "add-dark-mode",
  workdir: "/home/user/projects/myapp"
)

# Fire-and-forget (no follow-up needed)
iflow_launch(
  prompt: "Run the test suite and output the results.",
  name: "run-tests",
  workdir: "/home/user/projects/myapp",
  multi_turn_disabled: true
)

# Major refactoring with custom timeout
iflow_launch(
  prompt: "Refactor the database layer to use the repository pattern. Migrate all direct calls in src/services/ to use repositories in src/repositories/.",
  name: "refactor-db-repositories",
  workdir: "/home/user/projects/myapp",
  timeout: 600000
)
```

---

## 2. Monitoring sessions

### List sessions

```
# All sessions
iflow_sessions()

# Only running sessions
iflow_sessions(filter: "running")

# Completed sessions
iflow_sessions(filter: "completed")

# Failed sessions
iflow_sessions(filter: "failed")
```

Supported filter values: `all` / `running` / `starting` / `completed` / `failed` / `killed`

### View output

```
# Last 50 lines (default)
iflow_output(session: "fix-null-auth")

# Specific last N lines
iflow_output(session: "fix-null-auth", lines: 100)

# Full buffered output (up to 200 entries)
iflow_output(session: "fix-null-auth", full: true)
```

### Real-time streaming

```
# Switch to foreground (displays catchup of missed outputs + live stream)
iflow_fg(session: "fix-null-auth")

# Switch back to background (stops the stream, session continues)
iflow_bg(session: "fix-null-auth")

# Detach all foreground sessions from a channel
iflow_bg()
```

**Note:** `iflow_fg` first displays a catchup of everything that happened in the background, then starts live streaming.

---

## 3. Multi-turn interaction

> [!CAUTION]
> **`iflow_respond` must ONLY be called when iFlow explicitly signals it is waiting for input.**
> Calling `iflow_respond` while iFlow is still working will **immediately cancel the running task** and mark the session as `failed`.
> You will receive a wake event (`openclaw system event`) or a "Waiting for input" notification when iFlow is ready to receive a message. **Never call `iflow_respond` proactively — always wait for the signal.**

### Send a follow-up

```
# Reply to an iFlow question — ONLY after receiving a waiting-for-input signal
iflow_respond(session: "add-dark-mode", message: "Yes, use CSS variables for the theme colors.")

# Forward user's answer to a session
iflow_respond(session: "add-dark-mode", message: "The user says: use Tailwind dark: classes instead.")
```

`iflow_respond` accepts only two parameters: `session` (ID or name) and `message` (the text to send). There is no `interrupt` parameter — to stop a running session use `iflow_kill` instead.

### When to auto-respond vs forward to the user

**Auto-respond immediately with `iflow_respond` (only after waiting-for-input signal):**
- Permission requests to read/write files or run bash commands → `"Yes, proceed."`
- Confirmations like "Should I continue?" → `"Yes, continue."`
- Questions about the approach when only one is reasonable → Respond with the obvious choice
- Clarification requests about the codebase → Respond if you know, otherwise `"Use your best judgment."`

**Forward to the user:**
- Architecture decisions (Redis vs PostgreSQL, REST vs GraphQL...)
- Destructive operations (deleting files, dropping tables...)
- Ambiguous requirements not covered by the initial prompt
- Scope changes ("This will require refactoring 15 files")
- Anything involving credentials, secrets, or production environments
- When in doubt → always forward to the user

### Interaction cycle

1. Session launches → runs in background
2. Wake event `openclaw system event` arrives **only when** the session is waiting for input
3. Read the question with `iflow_output(session)`
4. Decide: auto-respond or forward
5. If auto-respond: `iflow_respond(session, answer)` — **only now is it safe to call**
6. If forward: relay the question to the user, wait for their response, then `iflow_respond`

> [!WARNING]
> If you call `iflow_respond` without receiving a waiting-for-input signal first, the session will be **cancelled immediately**. There is no recovery — you will need to relaunch the session.

---

## 4. Lifecycle management

### Stop a session

```
iflow_kill(session: "fix-null-auth")
```

Use when:
- The session is stuck or looping
- The user requests a stop

### Timeouts

- Idle multi-turn sessions are automatically killed after `idleTimeoutMinutes` (default: 30 min)
- If no output is received for `safetyNetIdleSeconds` (default: 600s), the session is considered waiting for input

### Check the result after completion

When a session completes (completion wake event):

1. `iflow_output(session: "xxx")` to read the result
2. Summarize the result to the user
3. If failed, analyze the error and decide: relaunch or escalate

---

## 5. Notifications

### Routing

Notifications are routed automatically based on the session's `workdir` using the `agentChannels` plugin config. Each workspace directory maps to a specific channel (e.g., `dingtalk|your-userid`).

### Events

| Event | What happens |
|---|---|
| Session starts | Silent |
| Session in foreground | Real-time stream |
| Session completed | Notification to the originating channel |
| Session failed | Error notification to the originating channel |
| Waiting for input | `openclaw system event` to wake the orchestrator + notification in the channel |
| Response sent | Echo in the channel |

---

## 6. Best practices

### Launch checklist

1. `agentChannels` is configured for this workdir → notifications arrive
2. `multi_turn: true` → interaction is possible after launch
3. `name` is descriptive → easy to identify in `iflow_sessions`
4. `workdir` points to the correct project → iFlow works in the right directory

### Parallel tasks

```
# Launch multiple sessions on independent tasks
iflow_launch(prompt: "Build the frontend auth page", name: "frontend-auth", workdir: "/app/frontend", multi_turn: true)
iflow_launch(prompt: "Build the backend auth API", name: "backend-auth", workdir: "/app/backend", multi_turn: true)
```

- Respect the `maxSessions` limit (default: 5)
- Each session must have a unique `name`
- Monitor each session individually via wake events

### Error handling

- If a session fails, read the full output to understand why
- Relaunch with a corrected prompt if the error is in the instruction
- Escalate to the user if the error is outside your control (permissions, network, missing dependencies)

### Reporting results

When a session completes:
1. Read the result with `iflow_output(session)`
2. Summarize the changes made to the user
3. Mention the files modified/created
4. Flag any issues encountered or remaining TODOs

---

## 7. Anti-patterns

| Anti-pattern | Consequence | Fix |
|---|---|---|
| Calling `iflow_respond` without a waiting-for-input signal | **Immediately cancels the running task**, session marked as `failed` | Only call `iflow_respond` after receiving a wake event or waiting-for-input notification |
| Passing `channel` explicitly | Bypasses automatic routing | Let `agentChannels` handle routing automatically |
| Forgetting `multi_turn: true` | Unable to send follow-ups with `iflow_respond` | Enable `multi_turn` except for explicit one-shots |
| Not checking the result of a completed session | The user doesn't know what happened | Always read `iflow_output` and summarize |
| Launching too many sessions in parallel | `maxSessions` limit reached, sessions rejected | Respect the limit, prioritize, sequence if necessary |
| Using the agent's `workdir` instead of the project's | iFlow works in the wrong directory | Always point to the target project directory |
| Not naming sessions | Hard to identify them in `iflow_sessions` | Always use `name` in kebab-case |
| Auto-responding to critical questions | Decisions made without the user's approval | When in doubt, forward to the user |
| Ignoring wake events | Sessions stuck waiting indefinitely | Handle each wake event promptly |

---

## 8. Quick tool reference

| Tool | Usage | Key parameters |
|---|---|---|
| `iflow_launch` | Launch a session | `prompt`, `name`, `workdir`, `multi_turn_disabled`, `timeout`, `max_turns`, `system_prompt`, `permission_mode`, `model` |
| `iflow_sessions` | List sessions | `filter` (`all`/`running`/`starting`/`completed`/`failed`/`killed`) |
| `iflow_output` | Read the output | `session`, `lines`, `full` |
| `iflow_fg` | Foreground + live stream | `session` |
| `iflow_bg` | Switch back to background | `session` |
| `iflow_kill` | Kill a session | `session` |
| `iflow_respond` | Send a follow-up (**only when waiting-for-input signal received**) | `session`, `message` |
| `iflow_stats` | Usage metrics | none |
