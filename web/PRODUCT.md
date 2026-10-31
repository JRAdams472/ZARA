# Zara Management Console — product context

**What it is:** the operations surface for Zara's mortgage fee rule lifecycle.
Rule engineers edit JDM decision graphs in DEV and promote them
DEV→QA→UAT→PROD; release managers sign off the PROD step; auditors read
QA/UAT history. A thin BFF over the management API — the browser never
touches Postgres or the engine, and access tokens never reach JS.

**Mode:** Operate. Scanability, consistency, and role clarity outrank
expression. These are internal users doing repeated technical work —
the interface recedes.

**Audience:** three personas with different power:

| Persona | Access |
|---|---|
| tenant_rule_engineer | DEV write, QA/UAT read, promote ≤UAT |
| tenant_release_manager | all envs write + PROD sign-off |
| tenant_auditor | QA/UAT read only |

The shell makes authority legible at a glance: environment chips show
exactly which envs the caller may enter (locked envs are visibly
disabled), the role badge names the persona's ceiling, and the drawer
states the current env's access tier (read/write).

**Visual world:** GitHub-dark per sibling convention (MPEx/LOLA) —
near-black surfaces (`#0d1117`/`#161b22`), laser-blue accent (`#58a6ff`),
`#30363d` borders, MUI/Emotion components, compact `fontSize: 13`,
`borderRadius: 6`, no-transform buttons. Restrained by design: the
palette is a locked house style, not a choice to revisit.

**Structure:** `/{env}/rules` (artifact table — key, kind, status,
sha256, timestamps), `/{env}/rules/{key}` (metadata + spec + JDM JSON),
`/{env}/promotions` (append-only history). Env is a URL segment — deep
links carry the lane; unpermitted envs redirect to the first allowed
one. Phase 2 adds the JDM editor (client-only); Phase 3 adds promotion
controls and grants admin.
