#!/usr/bin/env node
// zara devtoken (Node) — mints dev JWTs carrying tenant_id +
// permitted_environments. Generates a FRESH ephemeral RSA-2048 keypair
// each run (unless --key-in), writes the public JWKS for the shared
// .devkeys/ contract both planes read. Dev/test only, never prod.
//
//   node scripts/devtoken.mjs --tenant-id <uuid> --envs dev,qa \
//     --jwks-out ../.devkeys/jwks.json --key-out ../.devkeys/dev.pem

import { generateKeyPair, exportJWK, exportPKCS8, importPKCS8, SignJWT } from 'jose';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPrivateKey, createPublicKey } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => {
    if (!a.startsWith('--')) return [];
    const v = arr[i + 1];
    return [[a.slice(2), v && !v.startsWith('--') ? v : true]];
  }),
);

const tenantId = args['tenant-id'];
if (!tenantId) {
  console.error('--tenant-id <uuid> is required');
  process.exit(2);
}
const envs = String(args.envs ?? 'dev').split(',');
const sub = args.sub ?? 'zara-dev';
const iss = args.iss ?? 'zara-devtoken';
const aud = args.aud ?? 'zara-engine';
const ttl = Number(args.ttl ?? 3600);
const kid = args.kid ?? 'dev-1';

let privateKeyPem, jwk;
if (args['key-in']) {
  privateKeyPem = readFileSync(args['key-in'], 'utf8');
  const pub = createPublicKey(createPrivateKey(privateKeyPem));
  jwk = await exportJWK(pub);
} else {
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true, // --key-out needs PKCS8 export; dev-only material
  });
  privateKeyPem = await exportPKCS8(privateKey);
  jwk = await exportJWK(publicKey);
}
jwk.kid = kid;
jwk.use = 'sig';
jwk.alg = 'RS256';

const privateKey = await importPKCS8(privateKeyPem, 'RS256');
const token = await new SignJWT({ tenant_id: tenantId, permitted_environments: envs })
  .setProtectedHeader({ alg: 'RS256', kid })
  .setIssuer(iss)
  .setAudience(aud)
  .setSubject(sub)
  .setIssuedAt()
  .setExpirationTime(`${ttl}s`)
  .sign(privateKey);

const jwks = JSON.stringify({ keys: [jwk] });
if (args['jwks-out']) {
  mkdirSync(dirname(args['jwks-out']), { recursive: true });
  writeFileSync(args['jwks-out'], jwks);
  console.error(`jwks → ${args['jwks-out']}`);
}
if (args['key-out']) {
  mkdirSync(dirname(args['key-out']), { recursive: true });
  writeFileSync(args['key-out'], privateKeyPem);
  console.error(`private key → ${args['key-out']} (keep out of git)`);
}
console.log(token);
if (!args['jwks-out']) console.error(`jwks: ${jwks}`);
