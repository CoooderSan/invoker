/**
 * Invoker core type definitions
 */

// === shared metadata types ===

export type RequirementSource = 'manifest' | 'sidecar' | 'merged';
export type CheckSource = RequirementSource | 'derived';
export type CheckStatus = 'ok' | 'warning' | 'error';
export type CheckSeverity = 'blocking' | 'non_blocking';
export type RuntimeTarget = 'invoker' | 'claude' | 'codex' | 'unknown';
export type SkillResolutionSource = 'direct_path' | 'cwd' | 'registry' | 'target_dir';

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

export interface InvokerSidecar {
  schemaVersion?: string;
  requires?: SkillRequirements;
  notes?: string[];
}

export interface NormalizedSkill {
  manifest: SkillManifest;
  sidecar?: InvokerSidecar;
  effectiveRequires?: SkillRequirements;
  manifestPath: string;
  sidecarPath?: string;
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
}

export interface ScanOptions {
  target?: RuntimeTarget;
  targetRoot?: string;
}

export interface InvokerHostConfig {
  hosts?: Partial<Record<RuntimeTarget, { root?: string }>>;
}

export interface SkillRequirements {
  cli?: CliRequirement[];
  tokens?: TokenRequirement[];
  env?: EnvRequirement[];
  resources?: ResourceRequirement[];
  skills?: SkillDependencyRequirement[];
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

export interface SkillIntent {
  name: string;
  description: string;
  parameters?: Record<string, string>;
}

// === Doctor check result types ===

export type CheckCategory = 'cli' | 'token' | 'env' | 'resource' | 'skill' | 'permission' | 'manifest';

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

export interface DoctorReport {
  skillName: string;
  manifestPath: string;
  sidecarPath?: string;
  timestamp: string;
  overall: CheckStatus;
  summary: DoctorSummary;
  requirementsDeclared: boolean;
  checks: CheckResult[];
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
  operation?: 'install' | 'register' | 'configure';
}

// === Skill registry (local) ===

export interface InstalledSkill {
  name: string;
  version: string;
  path: string;
  installedAt: string;
  status: CheckStatus;
  target: RuntimeTarget;
  targetRoot?: string;
  managedInPlace?: boolean;
  manifestPath?: string;
  sidecarPath?: string;
  lastScannedAt?: string;
  lastDoctorAt?: string;
  lastStatusSummary?: string;
}

export interface SkillRegistry {
  skills: InstalledSkill[];
}
