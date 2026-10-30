//! RBAC roles + the role→environment scope map. The map is versioned in
//! code (ADR-0005): it can only change by deliberate review, never config.
//! Claims may *permit* an env, but a role without scope there still 403s —
//! effective access is the intersection.

export type Env = 'dev' | 'qa' | 'uat' | 'prod';
export const ENVS: readonly Env[] = ['dev', 'qa', 'uat', 'prod'];

export function parseEnv(s: string): Env | undefined {
  return (ENVS as readonly string[]).includes(s) ? (s as Env) : undefined;
}

export type Role = 'tenant_auditor' | 'tenant_rule_engineer' | 'tenant_release_manager';
export const ROLES: readonly Role[] = [
  'tenant_auditor',
  'tenant_rule_engineer',
  'tenant_release_manager',
];

/** Access tier a role holds in an environment ('none' = no entry). */
export type EnvAccess = 'read' | 'write';

/** MPE-113 role semantics: Auditor = QA/UAT view-only; Rule Engineer =
 *  DEV edit + promotion through UAT (write on dev, read qa/uat); Release
 *  Manager = all envs incl. PROD release. */
const ROLE_ENV_SCOPE: Record<Role, Partial<Record<Env, EnvAccess>>> = {
  tenant_auditor: { qa: 'read', uat: 'read' },
  tenant_rule_engineer: { dev: 'write', qa: 'read', uat: 'read' },
  tenant_release_manager: { dev: 'write', qa: 'write', uat: 'write', prod: 'write' },
};

/** Highest access tier `roles` hold in `env` — 'none' when out of scope. */
export function accessIn(roles: readonly Role[], env: Env): EnvAccess | 'none' {
  let best: EnvAccess | 'none' = 'none';
  for (const r of roles) {
    const a = ROLE_ENV_SCOPE[r][env];
    if (a === 'write') return 'write';
    if (a === 'read') best = 'read';
  }
  return best;
}

/** Envs where any of `roles` hold any access. */
export function scopedEnvs(roles: readonly Role[]): Env[] {
  return ENVS.filter((e) => accessIn(roles, e) !== 'none');
}

export function isRole(s: string): s is Role {
  return (ROLES as readonly string[]).includes(s);
}
