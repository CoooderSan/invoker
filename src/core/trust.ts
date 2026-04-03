import { resolveRequirementPath } from '../utils/fs.js';
import { scan } from './scanner.js';
import { executeSkillEntrypoint } from './runner.js';
import type {
  NormalizedSkill,
  ProblemFinding,
  ScanOptions,
  TrustCheckerConfig,
  TrustProviderResult,
  TrustReport,
} from '../types.js';

export async function buildTrustReport(normalized: NormalizedSkill, options: ScanOptions = {}): Promise<TrustReport> {
  const checkers = normalized.trust?.checkers;
  if (!checkers?.length) {
    return {
      status: 'unknown',
      findings: [],
      providers: [],
      summary: { total: 0, warning: 0, error: 0 },
    };
  }

  const findings: ProblemFinding[] = [];
  const providers: TrustProviderResult[] = [];

  for (const checker of checkers) {
    const result = await runTrustChecker(checker, normalized, options);
    findings.push(...result.findings);
    providers.push(result.provider);
  }

  const errorCount = findings.filter((finding) => finding.status === 'error').length;
  const warningCount = findings.filter((finding) => finding.status === 'warning').length;
  const status = deriveTrustStatus(findings, providers);

  return {
    status,
    findings,
    providers,
    summary: {
      total: findings.length,
      warning: warningCount,
      error: errorCount,
    },
  };
}

async function runTrustChecker(
  checker: TrustCheckerConfig,
  subject: NormalizedSkill,
  options: ScanOptions,
): Promise<{ findings: ProblemFinding[]; provider: TrustProviderResult }> {
  const providerName = checker.name || checker.skill || 'trust-checker';
  const checkedAt = new Date().toISOString();

  try {
    const target = checker.target ?? subject.target;
    const targetRoot = target === options.target ? options.targetRoot : target === subject.target ? subject.targetRoot : undefined;
    const checkerRef = resolveCheckerSkillRef(checker, subject);
    const checkerSkill = await scan(checkerRef, { target, targetRoot });
    const output = await executeCheckerSkill(checkerSkill, subject, checker);

    let parsed: unknown;
    try {
      parsed = JSON.parse(output.stdout || output.stderr || '{}');
    } catch {
      return {
        findings: [
          {
            name: providerName,
            category: 'manifest',
            status: 'warning',
            severity: 'non_blocking',
            provider: providerName,
            message: `Trust checker "${providerName}" returned invalid JSON output`,
            detail: (output.stdout || output.stderr || '').slice(0, 500),
            remediation: 'Fix the checker output so it returns machine-readable JSON',
            origin: 'observed',
          },
        ],
        provider: {
          name: providerName,
          status: 'warning',
          executed: true,
          message: 'Checker returned invalid JSON output',
          checkedAt,
        },
      };
    }

    return mapTrustCheckerResult(providerName, parsed, checkedAt);
  } catch (error) {
    return {
      findings: checker.required
        ? [
            {
              name: providerName,
              category: 'manifest',
              status: 'warning',
              severity: 'non_blocking',
              provider: providerName,
              message: `Trust checker "${providerName}" could not be executed`,
              detail: String(error),
              remediation: 'Verify the checker skill is available and runnable',
              origin: 'observed',
            },
          ]
        : [],
      provider: {
        name: providerName,
        status: checker.required ? 'warning' : 'unknown',
        executed: false,
        message: String(error),
        checkedAt,
      },
    };
  }
}

async function executeCheckerSkill(
  checkerSkill: NormalizedSkill,
  subject: NormalizedSkill,
  checker: TrustCheckerConfig,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const entrypoint = checkerSkill.manifest.entrypoint;
  if (!entrypoint) {
    throw new Error(`Trust checker skill "${checkerSkill.manifest.name}" has no entrypoint defined`);
  }

  const result = await executeSkillEntrypoint(checkerSkill, [subject.dir, ...(checker.args ?? [])], {
    INVOKER_TRUST_SUBJECT: subject.dir,
    INVOKER_TRUST_SUBJECT_NAME: subject.manifest.name,
    INVOKER_TRUST_SUBJECT_MANIFEST: subject.manifestPath,
    INVOKER_TRUST_SUBJECT_SIDECAR: subject.sidecarPath ?? '',
    INVOKER_TRUST_SUBJECT_TARGET: subject.target,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Checker exited with code ${result.exitCode}`);
  }

  return result;
}

function mapTrustCheckerResult(
  providerName: string,
  input: unknown,
  checkedAt: string,
): { findings: ProblemFinding[]; provider: TrustProviderResult } {
  const doc = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const rawFindings = Array.isArray(doc.findings) ? doc.findings : [];
  const findings = rawFindings
    .map((item) => toTrustFinding(providerName, item))
    .filter((item): item is ProblemFinding => item !== null);

  const explicitStatus = normalizeProviderStatus(doc.status);
  const status =
    findings.some((finding) => finding.status === 'error')
      ? 'error'
      : findings.some((finding) => finding.status === 'warning')
        ? 'warning'
        : explicitStatus ?? 'ok';

  return {
    findings,
    provider: {
      name: providerName,
      status,
      executed: true,
      message: typeof doc.message === 'string' ? doc.message : findings.length ? `${findings.length} trust finding(s)` : 'No trust findings',
      checkedAt,
    },
  };
}

function toTrustFinding(providerName: string, input: unknown): ProblemFinding | null {
  if (!input || typeof input !== 'object') return null;
  const finding = input as Record<string, unknown>;
  const rawStatus = String(finding.status ?? 'warning');
  const status = rawStatus === 'error' ? 'error' : 'warning';

  return {
    name: String(finding.name ?? finding.ruleId ?? providerName),
    category: 'manifest',
    status,
    severity: status === 'error' ? 'blocking' : 'non_blocking',
    provider: providerName,
    ruleId: finding.ruleId ? String(finding.ruleId) : undefined,
    message: String(finding.message ?? 'Trust checker reported a finding'),
    detail: finding.detail ? String(finding.detail) : undefined,
    remediation: finding.remediation ? String(finding.remediation) : undefined,
    detectedValue: finding.detectedValue ? String(finding.detectedValue) : undefined,
    expectedValue: finding.expectedValue ? String(finding.expectedValue) : undefined,
    origin: 'observed',
  };
}

function resolveCheckerSkillRef(checker: TrustCheckerConfig, subject: NormalizedSkill): string {
  const checkerRef = checker.skill ?? checker.name;
  return isPathLike(checkerRef) ? resolveRequirementPath(checkerRef, subject.dir) : checkerRef;
}

function isPathLike(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../') || value.startsWith('~/') || value.startsWith('/');
}

function normalizeProviderStatus(value: unknown): TrustProviderResult['status'] | undefined {
  if (value === 'ok' || value === 'warning' || value === 'error' || value === 'unknown') {
    return value;
  }
  return undefined;
}

function deriveTrustStatus(findings: ProblemFinding[], providers: TrustProviderResult[]): TrustReport['status'] {
  if (findings.some((finding) => finding.status === 'error')) return 'error';
  if (findings.some((finding) => finding.status === 'warning')) return 'warning';
  if (providers.some((provider) => provider.status === 'error')) return 'error';
  if (providers.some((provider) => provider.status === 'warning')) return 'warning';
  if (providers.some((provider) => provider.status === 'ok')) return 'ok';
  return 'unknown';
}
