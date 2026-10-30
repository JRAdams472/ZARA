import { describe, expect, it } from 'vitest';
import { accessIn, scopedEnvs, parseEnv } from '../../src/auth/roles.js';

describe('role→env scope', () => {
  it('auditor sees qa/uat read-only', () => {
    expect(accessIn(['tenant_auditor'], 'qa')).toBe('read');
    expect(accessIn(['tenant_auditor'], 'uat')).toBe('read');
    expect(accessIn(['tenant_auditor'], 'dev')).toBe('none');
    expect(accessIn(['tenant_auditor'], 'prod')).toBe('none');
    expect(scopedEnvs(['tenant_auditor'])).toEqual(['qa', 'uat']);
  });

  it('engineer writes dev, reads qa/uat, no prod', () => {
    expect(accessIn(['tenant_rule_engineer'], 'dev')).toBe('write');
    expect(accessIn(['tenant_rule_engineer'], 'qa')).toBe('read');
    expect(accessIn(['tenant_rule_engineer'], 'prod')).toBe('none');
  });

  it('release manager writes everywhere', () => {
    expect(accessIn(['tenant_release_manager'], 'prod')).toBe('write');
    expect(scopedEnvs(['tenant_release_manager'])).toEqual(['dev', 'qa', 'uat', 'prod']);
  });

  it('multi-role unions', () => {
    expect(accessIn(['tenant_auditor', 'tenant_rule_engineer'], 'dev')).toBe('write');
  });

  it('parseEnv allowlist', () => {
    expect(parseEnv('dev')).toBe('dev');
    expect(parseEnv('staging')).toBeUndefined();
  });
});
