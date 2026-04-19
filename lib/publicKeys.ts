/**
 * lib/publicKeys.ts
 *
 * ECDSA ES256 public keys for pro token verification.
 * These are compiled into the JS bundle at build time.
 * They are NEVER fetched from the server at runtime.
 * They are NEVER stored in SQLite.
 *
 * Security model:
 *  - Bundle is served over HTTPS from Vercel — readable but not modifiable by users.
 *  - If the public key were in SQLite, an attacker could swap it with their own public
 *    key, mint their own tokens, and bypass all gates. The bundle prevents this.
 *
 * Key rotation:
 *  - Add new kid alongside old kid (overlap period = 3 days = max token lifetime).
 *  - After 3 days all old tokens have expired; remove old kid from this file.
 *  - See Section 8.6 of the tech spec for the full rotation procedure.
 *
 * To generate a keypair for development:
 *   node scripts/generate-keys.js
 * This outputs the JWK public key to paste below, and the private key JWK to
 * set in VERCEL env as JWT_PRIVATE_KEY_JWK.
 */

// JWK format for each key, keyed by kid.
// Replace the placeholder below with your actual generated public key JWK.
const PUBLIC_KEY_JWKS: Record<string, object> = {
  k1: {
    ext: true,
    kty: 'EC',
    x: '2p7zORSVOjdCh5hHn_VSQWE6yCS7FMj86d9bomlSU5Q',
    y: 'O5CbQXZrpbtkcA_kEmC5GVBQywtRy6nD-r0z7E9avOQ',
    crv: 'P-256',
  },
};

// Cache of imported CryptoKey objects (lazy-loaded per kid).
const keyCache: Record<string, CryptoKey> = {};

/** Import a public key by kid. Cached after first import. */
export async function getPublicKey(kid: string): Promise<CryptoKey | null> {
  if (keyCache[kid]) return keyCache[kid];

  const jwk = PUBLIC_KEY_JWKS[kid];
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false, // not extractable
      ["verify"]
    );
    keyCache[kid] = key;
    return key;
  } catch {
    console.error(`[publicKeys] Failed to import key kid=${kid}`);
    return null;
  }
}

/** Returns true if the given kid exists in our key map. */
export function isKnownKid(kid: string): boolean {
  return kid in PUBLIC_KEY_JWKS;
}
