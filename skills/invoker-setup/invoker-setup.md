# invoker-setup

You are an AI assistant helping to set up and verify the runtime environment for an AI skill.

You have access to the `invoker` CLI. Always use `--json` flag so output is machine-readable.

## Step 1 — Check the skill

Run the doctor check on the target skill:

```
invoker doctor <skill> --json
```

Parse the JSON. Prefer these fields:

```json
{
  "skillName": "string",
  "readinessStatus": "ok" | "warning" | "error",
  "trustStatus": "ok" | "warning" | "error" | "unknown",
  "overallStatus": "ok" | "warning" | "error" | "unknown",
  "declaredProblems": [
    {
      "name": "string",
      "category": "cli" | "token" | "env" | "resource" | "setting" | "hostConfig" | "permission" | "manifest",
      "status": "warning" | "error",
      "message": "string",
      "remediation": "string"
    }
  ],
  "observedProblems": [
    {
      "name": "string",
      "category": "manifest" | "permission",
      "status": "warning" | "error",
      "message": "string"
    }
  ],
  "dependencyFindings": [
    {
      "name": "string",
      "status": "ok" | "warning" | "error",
      "required": true | false,
      "message": "string",
      "remediation": "string"
    }
  ],
  "remediationActions": [
    {
      "type": "install" | "configure" | "create" | "register" | "verify",
      "category": "cli" | "token" | "env" | "resource" | "skill" | "setting" | "hostConfig" | "permission" | "manifest",
      "name": "string",
      "status": "warning" | "error",
      "mode": "auto" | "manual",
      "description": "string",
      "command": "string",
      "remediation": "string"
    }
  ],
  "trustReport": {
    "status": "ok" | "warning" | "error" | "unknown",
    "findings": [
      {
        "provider": "string",
        "ruleId": "string",
        "status": "warning" | "error",
        "message": "string",
        "remediation": "string"
      }
    ],
    "providers": [
      {
        "name": "string",
        "status": "ok" | "warning" | "error" | "unknown",
        "executed": true | false
      }
    ]
  },

  // compatibility layer (fallback only)
  "overall": "ok" | "warning" | "error",
  "summary": { "total": N, "ok": N, "warning": N, "error": N, "blocking": N },
  "checks": []
}
```

Use `remediationActions` as the primary execution plan, and use `checks` only as fallback for older invoker versions.

## Step 2 — Categorize findings

Primary sources:
1. `remediationActions` (preferred)
2. `dependencyFindings` (especially for `requires.skills`)
3. `trustReport.findings` (security/trust advisory)
4. fallback: `checks`

Suggested handling:

| Source | Condition | Action |
|--------|-----------|--------|
| `remediationActions` | `status=error` and `mode=auto` | Execute the action (`fix` / `install`) |
| `remediationActions` | `status=error` and `mode=manual` | Ask user for required manual input |
| `dependencyFindings` | `status=error` and `required=true` | Run `invoker install <parent-skill>` to register/install dependency |
| `trustReport.findings` | any warning/error | Report as advisory risk; do not treat as readiness blocker |
| `observedProblems` | warning/error | Report context; avoid destructive automatic changes |

## Step 3 — Remediate blocking errors

Prioritize `remediationActions` with `status=error`:

### Auto actions (`mode=auto`)
- If category is `resource`, prefer:
  ```
  invoker fix <skill>
  ```
- If category is `cli` or `skill`, prefer:
  ```
  invoker install <skill>
  ```
Then re-run doctor and verify status changes.

### Manual actions (`mode=manual`)
- For token/env/settings/hostConfig/permission categories, ask the user to complete the required manual step using the action's `remediation` text.

### Trust findings
- Treat `trustReport.findings` as advisory in current Invoker behavior.
- Always surface them to the user clearly.
- Do not block execution solely due to trust findings when readiness is OK.

## Step 4 — Final check

After all remediations, run doctor again:
```
invoker doctor <skill> --json
```

Success condition (recommended):
- `readinessStatus === "ok"` or only non-blocking readiness warnings remain
- `overall !== "error"`

Then report:
> "Skill `<name>` is ready to run on host `<host>`."

If blocking readiness errors remain, list them explicitly and stop — do not attempt to run the skill.

If trust warnings/errors remain, include them as advisory risks in the final report.

## Notes

- Use `invoker list --json` to see all registered skills and their current status.
- Use `invoker scan <skill> --json` to inspect parsed dependencies without running checks.
- Use `invoker info <skill> --json` to get full metadata + doctor report in one call.
- Use `invoker hosts list` to inspect configured host roots.
- If `requirementsDeclared=false`, warn the user that the skill has no `requires` block in its manifest — full checking is not possible until that is added.
