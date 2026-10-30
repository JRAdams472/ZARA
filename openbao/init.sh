#!/bin/sh
# openbao-init — one-shot bootstrap for the Zara dev stack (LOLA port).
# Idempotent: safe to re-run on every `compose up`.
#
#   already initialized?  → just unseal (dev keeps a single 1-of-1 share)
#   fresh?                → init, persist unseal key + root token to the
#                           gitignored data/openbao dir, unseal, mount the
#                           zara-transit engine, create the secrets key,
#                           write the zara-mgmt policy, mint a scoped token.
#
# Secrets live in data/openbao (mode 600 files) — never in the repo.
# Sealed-state production ops (Shamir shares, key holders) are a runbook
# concern, not this script's.
set -eu

export BAO_ADDR="http://openbao:8200"
OUT_DIR="/out"

echo "openbao-init: waiting for openbao..."
i=0
until bao status >/dev/null 2>&1 || bao status 2>&1 | grep -q "Sealed.*true"; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { echo "openbao-init: timed out"; exit 1; }
  sleep 2
done

# `init -status` prints "Vault is [not] initialized" — match the exact
# phrase; "is not initialized" correctly fails the positive check.
if ! bao operator init -status 2>/dev/null | grep -q 'Vault is initialized'; then
  echo "openbao-init: initializing (1-of-1 dev shares — dev only)"
  # Plain-text output parsed with sed — the image has no jq, and JSON
  # grep parsing proved brittle.
  bao operator init -key-shares=1 -key-threshold=1 > /tmp/init.txt
  UNSEAL_KEY=$(sed -n 's/^Unseal Key 1: //p' /tmp/init.txt | tr -d '[:space:]')
  ROOT_TOKEN=$(sed -n 's/^Initial Root Token: //p' /tmp/init.txt | tr -d '[:space:]')
  [ -n "$UNSEAL_KEY" ] && [ -n "$ROOT_TOKEN" ] || { echo "openbao-init: init parse failed"; cat /tmp/init.txt; exit 1; }
  mkdir -p "$OUT_DIR"
  printf '%s' "$UNSEAL_KEY" > "$OUT_DIR/unseal-key"
  printf '%s' "$ROOT_TOKEN" > "$OUT_DIR/root-token"
  chmod 600 "$OUT_DIR/unseal-key" "$OUT_DIR/root-token"
else
  echo "openbao-init: already initialized"
  UNSEAL_KEY=$(cat "$OUT_DIR/unseal-key")
  ROOT_TOKEN=$(cat "$OUT_DIR/root-token")
fi

# Unseal — always attempted; on an unsealed server this is a harmless
# no-op (exit code aside, it changes nothing). Sealed-detection via JSON
# grep proved brittle across output formats, so don't gate on it.
echo "openbao-init: unsealing (no-op if already unsealed)"
bao operator unseal "$UNSEAL_KEY" >/dev/null 2>&1 || true

export BAO_TOKEN="$ROOT_TOKEN"

# Transit mount — the field-encryption engine (idempotent).
if ! bao secrets list 2>/dev/null | grep -q '^zara-transit/'; then
  echo "openbao-init: mounting zara-transit"
  bao secrets enable -path=zara-transit transit >/dev/null
fi

# Field-cipher key — created as ROOT here so the mgmt token can stay
# crypto-ops-only (it never gets keys/* admin). aes256-gcm96 is the
# AES-256-GCM data-key type required by ADR-0003.
if ! bao read zara-transit/keys/zara-mgmt-secrets >/dev/null 2>&1; then
  echo "openbao-init: creating zara-mgmt-secrets key"
  bao write zara-transit/keys/zara-mgmt-secrets type=aes256-gcm96 >/dev/null
fi

# Scoped policy — mgmt can do crypto ops on zara-transit only. No key
# create/delete/config, no sys/mounts — rotation is an ops action done
# with a root/break-glass token, not the service's standing credential.
echo "openbao-init: writing zara-mgmt policy"
bao policy write zara-mgmt - >/dev/null <<'POLICY'
path "zara-transit/encrypt/*"   { capabilities = ["create","update"] }
path "zara-transit/decrypt/*"   { capabilities = ["create","update"] }
path "zara-transit/rewrap/*"    { capabilities = ["create","update"] }
path "sys/seal-status"          { capabilities = ["read"] }
POLICY

# Scoped mgmt token — persisted for the service to pick up via mounted
# file. Regenerated when missing; a fresh token each init run is fine
# for dev.
echo "openbao-init: minting zara-mgmt token"
bao token create -policy=zara-mgmt -period=24h \
  | sed -n 's/^token  *//p' | tr -d '[:space:]' > "$OUT_DIR/api-token"
# Mode 644: Windows bind mounts can't chown, so the non-root mgmt
# (uid 10001) needs world-read on this scoped dev token. The root
# token + unseal key stay 600 — only this scoped token is readable.
chmod 644 "$OUT_DIR/api-token"

echo "openbao-init: done"
