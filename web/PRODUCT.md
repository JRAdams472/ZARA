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

**Sibling rule-editor anatomy** (house convention — keep identical in
MPEx and Zara PRODUCT.md; edit in both):

- **List → detail routes.** `/artifacts` renders a dense table (key,
  kind/status, timestamps) with filter inputs above; row →
  `/artifacts/{key}` detail (metadata + spec/graph). Deep links stay
  valid.
- **Revision state is a chip, not a guess.** `StatusChip` renders
  `published` as a success-outlined green chip and `draft` /
  `draft (edited)` as warning-outlined amber. Drafts are mutable
  working copies; published rows are immutable and versioned.
- **Lifecycle verbs are uniform.** `PUT` writes the draft, `Delete`
  removes the draft only, `Publish`/`Promote` mints the immutable
  revision. Nothing ever "edits published" — the UI offers
  new-draft-from-published instead.
- **Density with reveal.** Tables stay compact; detail lives behind
  row expanders (audit events, JSON detail) and per-surface filters,
  not behind page hops.
- **Errors and empties name the next action.** `ErrorPanel` (or an
  Alert) shows the API's message verbatim; empty states say what to do
  first, not just that nothing exists.
- **Authority is legible.** Role-restricted affordances hide from the
  nav, direct access renders a restriction message (never a blank or a
  bounce), and the shell always shows the signed-in identity + role and
  the current environment lane.
- **Env legibility.** Zara encodes the lane as `[env]` URL segments
  with locked-env chips; MPEx uses an in-shell selector. Either way
  the active lane is always visible and switching never mutates data.
- **Keys and hashes are mono.** Artifact keys, content hashes, and
  JSON details render in monospace; everything else uses the default
  compact type.
