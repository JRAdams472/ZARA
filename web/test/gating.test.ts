import { describe, expect, it } from 'vitest';
import { firstEffectiveEnv } from '@/lib/api';
import { isReleaseManager, promoteTargetFor } from '@/lib/gate';
import type { Whoami } from '@/lib/types';

const base: Whoami = {
  sub: 'u',
  tenantId: 't',
  permittedEnvs: [],
  roles: [],
  envAccess: { dev: 'none', qa: 'none', uat: 'none', prod: 'none' },
  effectiveEnvs: [],
};

describe('env gating (claims ∩ role scope)', () => {
  it('engineer: dev first, prod absent', () => {
    const who: Whoami = {
      ...base,
      permittedEnvs: ['dev', 'qa', 'uat', 'prod'],
      roles: ['tenant_rule_engineer'],
      envAccess: { dev: 'write', qa: 'read', uat: 'read', prod: 'none' },
      effectiveEnvs: ['dev', 'qa', 'uat'],
    };
    expect(firstEffectiveEnv(who)).toBe('dev');
    expect(who.effectiveEnvs).not.toContain('prod');
  });

  it('auditor: qa first — no dev edit, no prod', () => {
    const who: Whoami = {
      ...base,
      permittedEnvs: ['qa', 'uat'],
      roles: ['tenant_auditor'],
      envAccess: { dev: 'none', qa: 'read', uat: 'read', prod: 'none' },
      effectiveEnvs: ['qa', 'uat'],
    };
    expect(firstEffectiveEnv(who)).toBe('qa');
    expect(who.envAccess.dev).toBe('none');
    expect(who.envAccess.prod).toBe('none');
  });

  it('release manager: all four envs', () => {
    const who: Whoami = {
      ...base,
      permittedEnvs: ['dev', 'qa', 'uat', 'prod'],
      roles: ['tenant_release_manager'],
      envAccess: { dev: 'write', qa: 'write', uat: 'write', prod: 'write' },
      effectiveEnvs: ['dev', 'qa', 'uat', 'prod'],
    };
    expect(firstEffectiveEnv(who)).toBe('dev');
    expect(who.envAccess.prod).toBe('write');
  });

  it('token permits env the role lacks → effective set excludes it', () => {
    // e.g. auditor whose token claims dev: scope still wins.
    const who: Whoami = {
      ...base,
      permittedEnvs: ['dev', 'qa', 'uat'],
      roles: ['tenant_auditor'],
      envAccess: { dev: 'none', qa: 'read', uat: 'read', prod: 'none' },
      effectiveEnvs: ['qa', 'uat'],
    };
    expect(who.effectiveEnvs).toEqual(['qa', 'uat']);
  });

  it('empty effective set → undefined (routes to /no-access)', () => {
    expect(firstEffectiveEnv(base)).toBeUndefined();
  });
});

describe('promotion gating (mirrors mgmt canPromote)', () => {
  const engineer: Whoami = { ...base, roles: ['tenant_rule_engineer'] };
  const rm: Whoami = { ...base, roles: ['tenant_release_manager'] };
  const auditor: Whoami = { ...base, roles: ['tenant_auditor'] };

  it('engineer promotes through UAT only — never into PROD', () => {
    expect(promoteTargetFor(engineer, 'dev')).toBe('qa');
    expect(promoteTargetFor(engineer, 'qa')).toBe('uat');
    expect(promoteTargetFor(engineer, 'uat')).toBeNull(); // prod sign-off is RM-only
    expect(promoteTargetFor(engineer, 'prod')).toBeNull();
  });

  it('release manager promotes everywhere incl. PROD', () => {
    expect(promoteTargetFor(rm, 'uat')).toBe('prod');
    expect(promoteTargetFor(rm, 'dev')).toBe('qa');
    expect(promoteTargetFor(rm, 'prod')).toBeNull(); // no successor
  });

  it('auditor never promotes', () => {
    expect(promoteTargetFor(auditor, 'dev')).toBeNull();
    expect(promoteTargetFor(auditor, 'uat')).toBeNull();
  });

  it('admin surfaces are RM-only', () => {
    expect(isReleaseManager(rm)).toBe(true);
    expect(isReleaseManager(engineer)).toBe(false);
    expect(isReleaseManager(auditor)).toBe(false);
  });
});
