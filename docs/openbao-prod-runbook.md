# OpenBao production runbook

Zara's management plane uses OpenBao **transit** (`zara-transit` mount,
key `zara-mgmt-secrets`) for AES-256-GCM field encryption (ADR-0003).
The dev compose stack is deliberately permissive — raft storage,
`tls_disable`, 1-of-1 unseal shares, plaintext HTTP inside the docker
network, and an init script that mints a scoped token into
`data/openbao/` (gitignored). **None of that is acceptable in
production.** This runbook is the prod deployment contract; nothing here
changes code — `KMS_URL`/`KMS_TOKEN_FILE`/`KMS_MOUNT`/`KMS_KEY_NAME`
are the only seams mgmt reads.

## Topology

| Concern | Production posture |
|---|---|
| Cluster | 3- or 5-node raft cluster behind a load balancer; `raft` integrated storage (no external datastore to secure separately) |
| Sealing | Shamir `secret_shares = 5`, `secret_threshold = 3` — never 1-of-1 |
| Transport | TLS 1.3 everywhere; cert from the org CA on every listener, mTLS optional on the api listener |
| API access | mgmt service reaches `https://bao.<env>.internal:8200` only; no public ingress |
| Seal material | See "Break-glass" — never on the cluster, never in CI, never in the repo |

### Cluster config sketch (`server.hcl`)

```hcl
storage "raft" {
  path    = "/openbao/data"
  node_id = "bao-0"
  retry_join { leader_api_addr = "https://bao-1.internal:8200" }
  retry_join { leader_api_addr = "https://bao-2.internal:8200" }
}
listener "tcp" {
  address            = "0.0.0.0:8200"
  tls_cert_file      = "/openbao/tls/server.crt"
  tls_key_file       = "/openbao/tls/server.key"
  tls_min_version    = "tls13"
}
api_addr     = "https://bao-0.internal:8200"
cluster_addr = "https://bao-0.internal:8201"
ui = false
disable_mlock = false   # prod keeps mlock — secrets never hit swap
```

Key deltas from dev: `tls_disable` removed + `tls_min_version = tls13`,
`retry_join` for raft peers, `disable_mlock = false`.

## Initialization (one-time, per cluster)

1. Provision 3+ nodes, deploy config, start the cluster.
2. Initialize **on the leader** with Shamir shares:

   ```sh
   bao operator init -key-shares=5 -key-threshold=3 \
       -format=json > /secure/offline/bao-init.json   # write-once, then move offline
   ```

3. Distribute the 5 unseal shares to the designated **key-share holders**
   (see below), one share per person, via their secure channel — never
   email/Slack/clipboard. The initial root token goes to the bootstrap
   operator only, and is **revoked** once day-1 auth is configured.
4. Mount transit + create the key (idempotent — dev's `init.sh` does the
   same shape):

   ```sh
   bao secrets enable -path=zara-transit transit
   bao write -f zara-transit/keys/zara-mgmt-secrets
   ```

### Key-share holders

Named people, odd quorum, no single person can unseal alone:

| Share | Holder | Stored |
|---|---|---|
| 1 | Security lead | HSM/offline hardware token, personal custody |
| 2 | Platform/infra lead | HSM/offline hardware token, personal custody |
| 3 | Engineering manager | Sealed envelope in org safe, dual-control |
| 4 | Compliance/audit officer | Sealed envelope in org safe, dual-control |
| 5 | Break-glass (sealed together, requires 2 officers to open) | org safe, logged access |

Any 3 of 5 unseal. Losing ≥3 shares is **unrecoverable** — re-init and
re-encrypt all `tenant_secrets` (see "Loss of seal quorum" below).

## Scoped-token issuance

Mgmt must never run on the root token. Issue a scoped token per
environment, exactly the policy shape `openbao/init.sh` writes:

```hcl
# policy: zara-mgmt
path "zara-transit/encrypt/zara-mgmt-secrets"  { capabilities = ["update"] }
path "zara-transit/decrypt/zara-mgmt-secrets"  { capabilities = ["update"] }
path "zara-transit/rewrap/zara-mgmt-secrets"   { capabilities = ["update"] }
path "zara-transit/keys/zara-mgmt-secrets"     { capabilities = ["read"] }
```

```sh
bao policy write zara-mgmt zara-mgmt.hcl
bao token create -policy=zara-mgmt -period=24h -orphan=false -display-name=zara-mgmt-<env>
```

- **Store the token in the deployment's secret store** (k8s secret /
  cloud SM) and surface it to mgmt via `KMS_TOKEN_FILE` — never baked
  into images, never in env literals, never in logs.
- `-period=24h` forces periodic renewal; renewal is a no-op for mgmt
  (re-read `KMS_TOKEN_FILE` on restart or on a 401/403 → refresh).
- **Revoke** with `bao token revoke <accessor>`; audit accessors via
  `bao token accessors list`. Any suspected leak → revoke the accessor
  immediately — ciphertext in `tenant_secrets` is unreadable without a
  live transit token.

## Transit key rotation

`bao write -f zara-transit/keys/zara-mgmt-secrets/rotate` bumps the key
version — new envelopes seal under `vault:vN:` (latest). Existing rows
still decrypt via their stored version. After a rotation, run the
rewrap-all sweep to re-seal every envelope under the newest version:

```
POST /api/admin/secrets/rewrap-all   # RM role — per-row tx + audit (MPE-161)
```

Old versions stay decryption-capable unless `min_decryption_version` is
raised — raise it only after rewrap-all confirms zero failures, and
never above the oldest version still in use.

## Seal / unseal / re-key incidents

| Event | Procedure |
|---|---|
| **Node reboot / outage** | Node seals on start — one key-share holder runs `bao operator unseal` with their share (threshold reached across holders → unsealed). Raft peers re-join automatically. |
| **Seal intentionally** | `bao operator seal` (privileged op) — used for containment on suspected compromise; requires quorum to unseal again. |
| **Re-key (share compromise)** | `bao operator rekey -key-shares=5 -key-threshold=3` — generates NEW shares; old shares die. Redistribute to holders, revoke old custody. |
| **Rotate root/encryption** | Transit: `keys/rotate` + rewrap-all (above). Root token: revoke + issue new scoped tokens (root token should never be live in prod). |
| **Loss of seal quorum** (≥3 shares gone) | **Unrecoverable** — init a fresh cluster, new transit key, then re-encrypt every `tenant_secrets` row (all old ciphertext is unrecoverable — this is the catastrophic case the holder design exists to prevent). |

## Break-glass material

What must exist offline, where, and who touches it:

| Material | Location | Access |
|---|---|---|
| Unseal shares ×5 | Per-holder custody (table above) | Holder only, logged |
| Init JSON (`bao-init.json`) | Org safe, sealed envelope, dual-control | Bootstrap operator at init only, then sealed — never on a workstation |
| Root token | Revoked after day-1 setup; if retained, same sealed-envelope custody as init JSON | Dual-control, logged |
| TLS private keys | Org PKI/HSM | Cert-manager only |

Audit access quarterly; any break-glass use files a post-incident note
into `audit_events` review.

## What dev keeps (documented carve-outs)

- `tls_disable = 1`, plaintext HTTP on the docker network — loopback
  only, never reachable off the host.
- 1-of-1 unseal share — `data/openbao/unseal-key` + `root-token` are
  gitignored files on the dev host only.
- `openbao-init` auto-unseals + mints the scoped token on every `up`.
- `disable_mlock = true` — dev containers lack the capability.

These are the same carve-outs `docs/security.md` will enumerate (Z6
phase-2) — the seam (`KMS_URL`, `KMS_TOKEN_FILE`) is identical, so
moving to prod is a deployment change, not a code change.
