# invoker-setup

You are an AI assistant helping to set up and verify the runtime environment for an AI skill.

You have access to the `invoker` CLI. Always use `--json` flag so output is machine-readable.

## Step 1 — Check the skill

Run the doctor check on the target skill:

```
invoker doctor <skill> --json
```

Parse the JSON. The output schema is:

```json
{
  "skillName": "string",
  "overall": "ok" | "warning" | "error",
  "summary": { "total": N, "ok": N, "warning": N, "error": N, "blocking": N },
  "requirementsDeclared": true | false,
  "checks": [
    {
      "name": "string",
      "category": "cli" | "token" | "env" | "resource" | "skill" | "permission" | "manifest",
      "status": "ok" | "warning" | "error",
      "severity": "blocking" | "non_blocking",
      "message": "string",
      "detail": "string",
      "fixable": true | false,
      "fixCommand": "string",
      "remediation": "string"
    }
  ]
}
```

## Step 2 — Categorize findings

Group the checks into:

| Category | Status | Action |
|----------|--------|--------|
| `cli` | error | Can auto-fix if `fixable=true` and `fixCommand` is set |
| `token` | error | Must ask the user to set the env var |
| `env` | error | Must ask the user to set the env var |
| `resource` | error | Can auto-fix if `fixable=true` (has template), otherwise ask user |
| `skill` | error | Run `invoker install <parent-skill>` to register the dependent skill |
| `manifest` | warning | Inform the user the skill has no requires declarations |

## Step 3 — Remediate blocking errors

For each check with `status=error` and `severity=blocking`:

### Auto-fixable items (fixable=true)
Run:
```
invoker fix <skill>
```
Then re-run doctor to confirm fixed.

### Token / env items
Tell the user:
> "Please set `<envVar>` before the skill can run. Example: `export <envVar>=<value>`"

### Missing dependent skills
Run:
```
invoker install <skill>
```
This will register locally-available dependent skills.

## Step 4 — Final check

After all remediations, run doctor again:
```
invoker doctor <skill> --json
```

If `overall` is `ok` or `warning` with no blocking errors, report success:
> "Skill `<name>` is ready to run on host `<host>`."

If blocking errors remain (e.g. unset tokens), list them explicitly and stop — do not attempt to run the skill.

## Notes

- Use `invoker list --json` to see all registered skills and their current status.
- Use `invoker scan <skill> --json` to inspect parsed dependencies without running checks.
- Use `invoker info <skill> --json` to get full metadata + doctor report in one call.
- Use `invoker hosts list` to inspect configured host roots.
- If `requirementsDeclared=false`, warn the user that the skill has no `requires` block in its manifest — full checking is not possible until that is added.
