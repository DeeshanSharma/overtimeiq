#!/usr/bin/env node
/**
 * scripts/generate-keys.js
 *
 * Generates an ECDSA P-256 (ES256) keypair for pro token signing.
 * Run this once during initial setup:
 *   node scripts/generate-keys.js
 *
 * Output:
 *  - Private key JWK → set as JWT_PRIVATE_KEY_JWK in Vercel env
 *  - Public key JWK  → paste into lib/publicKeys.ts under the correct kid
 *
 * For key rotation, run again and follow Section 8.6 of the tech spec.
 */

const { webcrypto } = require("crypto");
const { subtle } = webcrypto;

async function main() {
  const kid = process.argv[2] ?? "k1";

  const keyPair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,           // extractable
    ["sign", "verify"]
  );

  const privateJwk = await subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await subtle.exportKey("jwk", keyPair.publicKey);

  // Remove key_ops and ext from the JWK — cleaner for storage
  delete privateJwk.key_ops;
  delete publicJwk.key_ops;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  ECDSA ES256 Keypair  ·  kid = "${kid}"`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("▸ PRIVATE KEY JWK (set as JWT_PRIVATE_KEY_JWK in Vercel env):");
  console.log("  ⚠  Keep this secret — never commit to source control.\n");
  console.log(JSON.stringify(privateJwk, null, 2));

  console.log("\n▸ PUBLIC KEY JWK (paste into lib/publicKeys.ts):");
  console.log(`  Under PUBLIC_KEY_JWKS["${kid}"] = { ... }\n`);
  console.log(JSON.stringify(publicJwk, null, 2));

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Also set JWT_SIGNING_KID=" + kid + " in Vercel env.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(console.error);
