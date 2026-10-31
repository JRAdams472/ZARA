// @vitest-environment jsdom
//! Editor surface tests — the real components mount under jsdom with
//! @gorules/jdm-editor stubbed (monaco/antd can't run here). Mutations
//! are asserted at the fetch layer: method, path, and body reaching /bff.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock('@gorules/jdm-editor', () => ({
  DecisionGraph: ({
    value,
    onChange,
    disabled,
  }: {
    value: { nodes: { id: string }[]; edges: unknown[] } | null;
    onChange?: (v: unknown) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="grl" data-disabled={String(!!disabled)}>
      <button
        data-testid="grl-edit"
        onClick={() =>
          onChange?.({ nodes: [...(value?.nodes ?? []), { id: 'edited' }], edges: value?.edges ?? [] })
        }
      >
        grl-edit
      </button>
    </div>
  ),
}));

import DecisionEditor from '@/components/DecisionEditor';
import RuleEditor from '@/components/RuleEditor';
import NewRuleButton from '@/components/NewRuleButton';
import { canEditRule, canWriteEnv } from '@/lib/gate';
import type { RuleDetail, Whoami } from '@/lib/types';

const draftRule = (over: Partial<RuleDetail> = {}): RuleDetail => ({
  key: 'origination.base',
  kind: 'base_fee',
  status: 'draft',
  sha256: null,
  createdBy: 'eng',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  publishedAt: null,
  spec: { nodes: [{ id: 'in' }], edges: [] },
  jdm: {},
  ...over,
});

const who = (envAccess: Whoami['envAccess']): Whoami => ({
  sub: 's',
  tenantId: 't',
  permittedEnvs: ['dev', 'qa', 'uat', 'prod'],
  roles: [],
  envAccess,
  effectiveEnvs: ['dev', 'qa', 'uat'],
});

function renderClient(el: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

describe('DecisionEditor mount', () => {
  it('dynamic wrapper resolves and mounts the inner graph', async () => {
    renderClient(
      <DecisionEditor value={{ nodes: [], edges: [] }} onChange={() => undefined} />,
    );
    expect(await screen.findByTestId('grl')).toBeTruthy();
  });
});

describe('role + env gating', () => {
  const write = who({ dev: 'write', qa: 'read', uat: 'read', prod: 'none' });
  const readOnly = who({ dev: 'read', qa: 'read', uat: 'read', prod: 'none' });

  it('dev-write + draft → editable; everything else read-only', () => {
    expect(canEditRule(write, 'dev', 'draft')).toBe(true);
    expect(canEditRule(write, 'dev', 'published')).toBe(false);
    expect(canEditRule(write, 'qa', 'draft')).toBe(false);
    expect(canEditRule(readOnly, 'dev', 'draft')).toBe(false);
    expect(canWriteEnv(write, 'dev')).toBe(true);
    expect(canWriteEnv(write, 'qa')).toBe(false);
    expect(canWriteEnv(readOnly, 'dev')).toBe(false);
  });

  it('editable draft renders the mutation bar; read-only renders none', async () => {
    renderClient(
      <RuleEditor env="dev" ruleKey="origination.base" initialRule={draftRule()} canWrite />,
    );
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeTruthy();
    expect((await screen.findByTestId('grl')).dataset.disabled).toBe('false');

    cleanup();
    renderClient(
      <RuleEditor env="dev" ruleKey="origination.base" initialRule={draftRule()} canWrite={false} />,
    );
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(screen.getByText(/read access to DEV/)).toBeTruthy();
    expect((await screen.findByTestId('grl')).dataset.disabled).toBe('true');
  });

  it('non-DEV envs render read-only even for dev-write roles', async () => {
    renderClient(
      <RuleEditor env="qa" ruleKey="origination.base" initialRule={draftRule()} canWrite />,
    );
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect((await screen.findByTestId('grl')).dataset.disabled).toBe('true');
  });
});

describe('draft lifecycle at the fetch layer', () => {
  it('edit → Save draft PUTs {spec} to /bff/api/envs/dev/rules/:key', async () => {
    const spy = stubFetch(() => json(200, { key: 'origination.base' }));
    renderClient(
      <RuleEditor env="dev" ruleKey="origination.base" initialRule={draftRule()} canWrite />,
    );
    fireEvent.click(await screen.findByTestId('grl-edit'));
    expect(screen.getByText('unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bff/api/envs/dev/rules/origination.base');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      spec: { nodes: [{ id: 'in' }, { id: 'edited' }], edges: [] },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('Publish POSTs the publish route and surfaces the sha256', async () => {
    const spy = stubFetch(() => json(200, { key: 'k', sha256: 'a'.repeat(64) }));
    renderClient(
      <RuleEditor env="dev" ruleKey="origination.base" initialRule={draftRule()} canWrite />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bff/api/envs/dev/rules/origination.base/publish');
    expect(init.method).toBe('POST');
    expect(await screen.findByText(/Published — sha256/)).toBeTruthy();
  });

  it('Delete draft DELETEs and navigates back to the list', async () => {
    const spy = stubFetch(() => json(200, { deleted: 'origination.base' }));
    renderClient(
      <RuleEditor env="dev" ruleKey="origination.base" initialRule={draftRule()} canWrite />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bff/api/envs/dev/rules/origination.base');
    expect(init.method).toBe('DELETE');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dev/rules'));
  });

  it('PII-guard 400 reaches the form verbatim', async () => {
    stubFetch(() =>
      json(400, { error: 'PII-class field rejected at spec.nodes[1].content.ssn' }),
    );
    renderClient(
      <RuleEditor env="dev" ruleKey="origination.base" initialRule={draftRule()} canWrite />,
    );
    fireEvent.click(await screen.findByTestId('grl-edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      await screen.findByText('PII-class field rejected at spec.nodes[1].content.ssn'),
    ).toBeTruthy();
  });

  it('published + dev-write offers New draft from the published spec', async () => {
    const spec = { nodes: [{ id: 'in' }, { id: 'tbl' }], edges: [{ id: 'e' }] };
    const spy = stubFetch(() => json(201, { key: 'origination.base' }));
    renderClient(
      <RuleEditor
        env="dev"
        ruleKey="origination.base"
        initialRule={draftRule({ status: 'published', sha256: 'a'.repeat(64), spec })}
        canWrite
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New draft' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bff/api/envs/dev/rules');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      key: 'origination.base',
      kind: 'base_fee',
      spec,
    });
  });
});

describe('NewRuleButton', () => {
  it('validates the key, POSTs a starter draft, navigates to it', async () => {
    const spy = stubFetch(() => json(201, { key: 'origination.new' }));
    renderClient(<NewRuleButton env="dev" />);
    fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
    const input = await screen.findByLabelText('Key');
    fireEvent.change(input, { target: { value: 'Bad Key!' } });
    expect(
      (screen.getByRole('button', { name: 'Create draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(input, { target: { value: 'origination.new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bff/api/envs/dev/rules');
    const body = JSON.parse(String(init.body)) as {
      key: string;
      kind: string;
      spec: { nodes: unknown[]; edges: unknown[] };
    };
    expect(body.key).toBe('origination.new');
    expect(body.kind).toBe('base_fee');
    expect(body.spec.nodes.length).toBe(2);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dev/rules/origination.new'));
  });

  it('server 409 surfaces in the dialog', async () => {
    stubFetch(() => json(409, { error: 'a draft with this key already exists' }));
    renderClient(<NewRuleButton env="dev" />);
    fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
    fireEvent.change(await screen.findByLabelText('Key'), {
      target: { value: 'origination.base' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByText('a draft with this key already exists')).toBeTruthy();
  });
});
