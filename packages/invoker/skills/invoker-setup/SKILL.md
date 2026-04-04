---
name: invoker-setup
version: 0.1.1
description: >
  Bootstrap a skill-first install flow with the Invoker control plane. Use this
  when the user wants to set up, bootstrap, install, or verify a skill on the
  current host: first ensure Invoker is available, then delegate install,
  registration, and readiness remediation to Invoker until the target skill is
  ready to run.
requires:
  cli:
    - name: invoker
      command: invoker
      versionCommand: invoker --version
      installHint: "Run: npm install -g @cooodersan/invoker  or  npx -y @cooodersan/invoker"
      installCommand: "npm install -g @cooodersan/invoker"
intents:
  - name: bootstrap
    description: >
      Ensure Invoker is available, then bootstrap a target skill to a ready
      state on the current host.
    parameters:
      skill: path or name of the skill to bootstrap

  - name: check
    description: >
      Return the Invoker bootstrap or doctor report for a target skill.
    parameters:
      skill: path or name of the skill to inspect
---

# invoker-setup

You are the skill-first bootstrap wrapper for Invoker.

Your job is not to reimplement readiness logic yourself. Your job is:

1. make sure the `invoker` CLI is available
2. treat the target as a skill that may need to be materialized, installed, or registered into the current host first
3. delegate bootstrap and remediation to Invoker
4. surface any remaining manual steps clearly to the user

Prefer machine-readable output whenever possible.

## Step 1 — Ensure `invoker` exists

First, check whether Invoker is already available:

```bash
invoker --version
```

If that succeeds, continue to Step 2.

If it fails, treat this skill as the install entrypoint for the whole app.

Default behavior: prefer a persistent global install. Do not jump to `npx` first.

Required decision rule:

1. Check `invoker --version`
2. If missing, first try or recommend the global install
3. Only use `npx -y @cooodersan/invoker ...` when:
   - the user explicitly does not want a global install
   - the environment blocks global install
   - or the global install attempt failed

Preferred persistent install:

```bash
npm install -g @cooodersan/invoker
```

Fallback only when global install is not possible:

```bash
npx -y @cooodersan/invoker bootstrap <skill> --json
```

If the environment allows automatic installation, you should ask for or use the persistent install command first.

## Step 2 — Delegate to Invoker bootstrap

Preferred command when `invoker` is already available:

```bash
invoker bootstrap <skill> --json
```

Fallback only when `invoker` is still unavailable after the global-install path:

```bash
npx -y @cooodersan/invoker bootstrap <skill> --json
```

Parse the JSON. Prefer these top-level fields:

```json
{
  "status": "ready" | "blocked" | "missing" | "failed",
  "invokerCli": {
    "status": "available" | "installed" | "missing" | "failed",
    "command": "invoker",
    "detectedPath": "string",
    "installCommand": "string",
    "fallbackCommand": "string"
  },
  "installAttempted": true,
  "installPlan": {},
  "doctorReport": {
    "skillName": "string",
    "primaryDocPath": "string",
    "primaryDocFormat": "markdown" | "yaml",
    "warnings": [],
    "readinessStatus": "ok" | "warning" | "error",
    "trustStatus": "ok" | "warning" | "error" | "unknown",
    "overallStatus": "ok" | "warning" | "error" | "unknown",
    "declaredProblems": [],
    "observedProblems": [],
    "dependencyFindings": [],
    "remediationActions": [],
    "trustReport": {}
  }
}
```

## Step 3 — Handle bootstrap result

### If `status === "missing"`
Invoker is not on PATH yet and the preferred global-install path did not run or did not succeed.

Tell the user to either:

```bash
npm install -g @cooodersan/invoker
```

If global install is not acceptable in the current environment, then and only then run the one-shot bootstrap directly:

```bash
npx -y @cooodersan/invoker bootstrap <skill> --json
```

### If `status === "failed"`
Report the failure message directly. Do not invent alternative remediation beyond:
- retrying the provided install command
- using the one-shot fallback
- asking the user to resolve the shell / PATH issue

### If `status === "blocked"`
Bootstrap ran, but the target skill still has blocking readiness issues.

Use `doctorReport.remediationActions` as the primary execution plan.

Suggested handling:

| Condition | Action |
|-----------|--------|
| `status=error` and `mode=auto` | Prefer `invoker install <skill>` or `invoker fix <skill>` |
| `category=resource` | Prefer `invoker fix <skill>` |
| `category=cli` or `category=skill` | Prefer `invoker install <skill>` |
| `mode=manual` | Ask the user to complete the remediation exactly as described |
| `doctorReport.warnings` | Report as metadata advisory, not a readiness blocker |
| `trustReport.findings` | Report as advisory risk, not a readiness blocker by itself |

After any remediation, run bootstrap or doctor again and verify the result.

### If `status === "ready"`
The skill is ready or only has non-blocking warnings.

Report clearly:

> Skill `<name>` is ready on the current host.

If trust warnings remain, include them as advisory notes.

## Notes

- Prefer `invoker bootstrap <skill> --json` over stitching `doctor/install/fix` together yourself.
- Prefer a globally installed `invoker` binary over `npx` for normal repeated use.
- Use `doctorReport.remediationActions` as the source of truth for next steps.
- Use `doctorReport.dependencyFindings` to explain dependent skill issues.
- Use `doctorReport.warnings` to explain `SKILL.md` vs legacy yaml compatibility state.
- Use `doctorReport.trustReport` for advisory trust findings.
- Treat `SKILL.md` as the single source of truth for this skill; do not recreate a separate `skill.yaml` + markdown split.
- Only ask the user for manual work when the action is explicitly `mode: "manual"` or when Invoker itself is not yet available.
