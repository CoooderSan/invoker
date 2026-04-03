/**
 * Invoker core type definitions
 */

// === shared metadata types ===

export type RequirementSource = 'manifest' | 'sidecar' | 'merged';
export type CheckSource = RequirementSource | 'derived';
export type CheckStatus = 'ok' | 'warning' | 'error';
export type CheckSeverity = 'blocking' | 'non_blocking';
export type ReadinessStatus = CheckStatus;
export type TrustStatus = CheckStatus | 'unknown';
export type OverallStatus = CheckStatus | 'unknown';
export type RuntimeTarget = 'invoker' | 'claude' | 'codex' | 'unknown';
export type SkillResolutionSource = 'direct_path' | 'cwd' | 'registry' | 'target_dir';
export type SkillDocumentFormat = 'markdown' | 'yaml';
export type RemoteSourceType = 'http_index';

export interface RequirementMetadata {
  source?: RequirementSource;
}

// === skill.yaml / sidecar schema types ===

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  entrypoint?: string;
  requires?: SkillRequirements;
  intents?: SkillIntent[];
}

export interface TrustCheckerConfig {
  name: string;
  skill?: string;
  target?: RuntimeTarget;
  args?: string[];
  required?: boolean;
  timeoutMs?: number;
}

export interface TrustConfig {
  checkers?: TrustCheckerConfig[];
}

export interface InvokerSidecar {
  schemaVersion?: string;
  requires?: SkillRequirements;
  trust?: TrustConfig;
  notes?: string[];
}

export interface ScanWarning {
  code: 'legacy_yaml' | 'duplicate_primary_doc';
  message: string;
  paths: string[];
}

export interface NormalizedSkill {
  manifest: SkillManifest;
  sidecar?: InvokerSidecar;
  effectiveRequires?: SkillRequirements;
  trust?: TrustConfig;
  manifestPath: string;
  sidecarPath?: string;
  primaryDocPath: string;
  primaryDocFormat: SkillDocumentFormat;
  warnings: ScanWarning[];
  dir: string;
  target: RuntimeTarget;
  targetRoot?: string;
  resolutionSource: SkillResolutionSource;
  location: ResolvedSkillLocation;
}

export interface ResolvedSkillLocation {
  target: RuntimeTarget;
  targetRoot?: string;
  source: SkillResolutionSource;
  skillDir: string;
  manifestPath: string;
  primaryDocPath: string;
  primaryDocFormat: SkillDocumentFormat;
}

export interface ScanOptions {
  target?: RuntimeTarget;
  targetRoot?: string;
}

export interface RegisterSkillMetadata {
  installedFrom?: InstalledSkill['installedFrom'];
  sourceName?: string;
  sourceVersion?: string;
}

export interface RemoteSourceConfig {
  name: string;
  type: RemoteSourceType;
  indexUrlTemplate: string;
  tokenEnv?: string;
  timeoutMs?: number;
}

export interface RemoteSkillPackage {
  name: string;
  version: string;
  downloadUrl: string;
  sha256?: string;
}

export interface RemoteInstallRequest {
  skill: string;
  version?: string;
  target: RuntimeTarget;
  targetRoot: string;
  source: string;
  force?: boolean;
}

export interface InstallOptions extends ScanOptions {
  source?: string;
  version?: string;
  force?: boolean;
}

export interface InvokerHostConfig {
  hosts?: Partial<Record<RuntimeTarget, { root?: string }>>;
  sources?: RemoteSourceConfig[];
  defaultSource?: string;
}

export interface SkillRequirements {
  cli?: CliRequirement[];
  tokens?: TokenRequirement[];
  env?: EnvRequirement[];
  resources?: ResourceRequirement[];
  skills?: SkillDependencyRequirement[];
  settings?: SettingRequirement[];
  hostConfig?: HostConfigRequirement[];
  permissions?: string[];
}

export interface CliRequirement extends RequirementMetadata {
  name: string;
  command?: string;        // actual binary name if different from `name`
  versionCommand?: string; // e.g. "git --version"
  versionPattern?: string; // regex to extract version from output
  minVersion?: string;     // semver
  installHint?: string;    // human-readable install instruction
  installCommand?: string; // auto-install command (e.g. "brew install git")
}

export interface TokenRequirement extends RequirementMetadata {
  name: string;
  envVar?: string;         // environment variable name
  description?: string;
  required?: boolean;
  validationUrl?: string;  // URL to test token validity
}

export interface EnvRequirement extends RequirementMetadata {
  name: string;
  envVar: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface ResourceRequirement extends RequirementMetadata {
  name: string;
  path?: string;
  description?: string;
  templateUrl?: string;    // URL to download template
  template?: string;       // inline template content
}

export interface SkillDependencyRequirement extends RequirementMetadata {
  name: string;
  path?: string;
  description?: string;
  required?: boolean;
}

export interface SettingRequirement extends RequirementMetadata {
  key: string;
  host?: RuntimeTarget;
  description?: string;
  required?: boolean;
  expectedValue?: string;
}

export interface HostConfigRequirement extends RequirementMetadata {
  name: string;
  host?: RuntimeTarget;
  kind: 'root_exists' | 'root_accessible';
  description?: string;
  required?: boolean;
}

export interface SkillIntent {
  name: string;
  description: string;
  parameters?: Record<string, string>;
}

// === Doctor check result types ===

export type CheckCategory = 'cli' | 'token' | 'env' | 'resource' | 'skill' | 'setting' | 'hostConfig' | 'permission' | 'manifest';

export interface CheckResult {
  name: string;
  category: CheckCategory;
  status: CheckStatus;
  message: string;
  detail?: string;
  fixable?: boolean;
  fixCommand?: string;
  source?: CheckSource;
  severity?: CheckSeverity;
  required?: boolean;
  remediation?: string;
  detectedValue?: string;
  expectedValue?: string;
  suggestedSkillPath?: string;
  suggestedTarget?: RuntimeTarget;
  suggestedTargetRoot?: string;
}

export interface DoctorSummary {
  total: number;
  ok: number;
  warning: number;
  error: number;
  blocking: number;
}

export type ProblemOrigin = 'declared' | 'observed';
export type RemediationActionType = 'install' | 'configure' | 'create' | 'register' | 'verify';

export interface ProblemFinding {
  name: string;
  category: CheckCategory;
  status: Exclude<CheckStatus, 'ok'>;
  source?: CheckSource;
  severity?: CheckSeverity;
  provider?: string;
  ruleId?: string;
  message: string;
  detail?: string;
  remediation?: string;
  detectedValue?: string;
  expectedValue?: string;
  fixable?: boolean;
  fixCommand?: string;
  origin: ProblemOrigin;
}

export interface DependencyFinding {
  name: string;
  status: CheckStatus;
  source?: CheckSource;
  severity?: CheckSeverity;
  message: string;
  detail?: string;
  remediation?: string;
  required: boolean;
  suggestedSkillPath?: string;
  suggestedTarget?: RuntimeTarget;
  suggestedTargetRoot?: string;
  detectedValue?: string;
  expectedValue?: string;
}

export interface RemediationAction {
  type: RemediationActionType;
  category: CheckCategory;
  name: string;
  status: Exclude<CheckStatus, 'ok'>;
  mode: 'auto' | 'manual';
  description: string;
  command?: string;
  remediation?: string;
  source?: CheckSource;
  target?: RuntimeTarget;
  targetRoot?: string;
  path?: string;
  expectedValue?: string;
}

export interface ReadinessReport {
  status: ReadinessStatus;
  summary: DoctorSummary;
  declaredProblems: ProblemFinding[];
  observedProblems: ProblemFinding[];
  dependencyFindings: DependencyFinding[];
  remediationActions: RemediationAction[];
}

export interface TrustProviderResult {
  name: string;
  status: TrustStatus;
  executed: boolean;
  message?: string;
  checkedAt?: string;
}

export interface TrustReport {
  status: TrustStatus;
  findings: ProblemFinding[];
  providers?: TrustProviderResult[];
  summary?: {
    total: number;
    warning: number;
    error: number;
  };
}

export interface DoctorReport {
  skillName: string;
  manifestPath: string;
  sidecarPath?: string;
  primaryDocPath?: string;
  primaryDocFormat?: SkillDocumentFormat;
  warnings?: ScanWarning[];
  timestamp: string;
  overall: CheckStatus;
  overallStatus: OverallStatus;
  readinessStatus: ReadinessStatus;
  trustStatus: TrustStatus;
  summary: DoctorSummary;
  requirementsDeclared: boolean;
  checks: CheckResult[];
  declaredProblems: ProblemFinding[];
  observedProblems: ProblemFinding[];
  dependencyFindings: DependencyFinding[];
  remediationActions: RemediationAction[];
  readinessReport: ReadinessReport;
  trustReport?: TrustReport;
}

// === Installer types ===

export interface InstallPlan {
  skillName: string;
  steps: InstallStep[];
}

export interface InstallStep {
  type: 'cli' | 'token' | 'env' | 'resource' | 'skill' | 'config';
  name: string;
  action: string;
  command?: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  error?: string;
  mode?: 'auto' | 'manual';
  source?: CheckSource;
  remediation?: string;
  path?: string;
  host?: RuntimeTarget;
  operation?: 'install' | 'register' | 'configure' | 'fetch' | 'materialize';
}

// === Skill registry (local) ===

export interface InstalledSkill {
  name: string;
  version: string;
  path: string;
  installedAt: string;
  status: CheckStatus;
  readinessStatus?: ReadinessStatus;
  trustStatus?: TrustStatus;
  overallStatus?: OverallStatus;
  blockingCount?: number;
  target: RuntimeTarget;
  targetRoot?: string;
  managedInPlace?: boolean;
  installedFrom?: 'local' | 'remote' | 'discovered';
  sourceName?: string;
  sourceVersion?: string;
  manifestPath?: string;
  sidecarPath?: string;
  primaryDocPath?: string;
  primaryDocFormat?: SkillDocumentFormat;
  warnings?: ScanWarning[];
  lastScannedAt?: string;
  lastDoctorAt?: string;
  lastStatusSummary?: string;
}

export interface SkillRegistry {
  skills: InstalledSkill[];
}
