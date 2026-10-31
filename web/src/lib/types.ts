//! Shared types + constants — safe for both server and client bundles.
//! No 'server-only' marker here: client components need these shapes.

export type Env = 'dev' | 'qa' | 'uat' | 'prod';
export const ENVS: readonly Env[] = ['dev', 'qa', 'uat', 'prod'];
export type EnvAccess = 'read' | 'write' | 'none';
export type Role = 'tenant_auditor' | 'tenant_rule_engineer' | 'tenant_release_manager';

export interface Whoami {
  sub: string;
  tenantId: string;
  permittedEnvs: string[];
  roles: Role[];
  envAccess: Record<Env, 'read' | 'write' | 'none'>;
  effectiveEnvs: Env[];
}

export interface RuleMeta {
  key: string;
  kind: string;
  status: 'draft' | 'published';
  sha256: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface RuleDetail extends RuleMeta {
  spec: unknown;
  jdm: unknown;
}

export interface PromotionRow {
  artifactKey: string;
  artifactId: string;
  fromEnv: string;
  toEnv: string;
  graphSha256: string;
  promotedBy: string;
  promotedAt: string;
}

export interface PromoteResult {
  key: string;
  fromEnv: string;
  toEnv: string;
  artifactId: string;
  sha256: string;
  published: boolean;
  fingerprint?: string;
}

export interface GrantRow {
  id: string;
  subjectType: string;
  subject: string;
  role: string;
  grantedBy: string;
  grantedAt: string;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorSub: string;
  action: string;
  detail: unknown;
}

export interface AuditVerifyResult {
  checked: number;
  ok: boolean;
  firstBadId?: string;
  reason?: string;
}
