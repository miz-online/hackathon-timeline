/**
 * Team self-registration ("Registrierung") entries.
 *
 * A registration entry carries a short, unguessable token. Its public URL is
 * `/tr/<token>`. Every room shows its own 10-character *variant* of that token,
 * derived cryptographically from the base token and the room id, so the server
 * can recalculate which room a scanned code came from and preselect it — while
 * the URL stays as short as the base token.
 *
 * The base token itself is the HMAC key: it is secret and unguessable, so no
 * additional server secret is needed and variants cannot be forged.
 */

/** Alphabet without visually confusable characters. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REGISTER_TOKEN_LENGTH = 10;
export const EDIT_CODE_LENGTH = 12;

function encode(bytes: Uint8Array, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i % bytes.length] % ALPHABET.length];
  return out;
}

export function randomToken(length = REGISTER_TOKEN_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return encode(bytes, length);
}

/** Room-specific variant of a registration token (same length as the base). */
export async function roomTokenVariant(baseToken: string, roomId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(baseToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`room:${roomId}`));
  return encode(new Uint8Array(sig), REGISTER_TOKEN_LENGTH);
}

/**
 * Recomputes every room variant of a base token and returns the room whose
 * variant matches `token`. `null` means the base token (no room preselected).
 */
export async function roomForToken(
  baseToken: string,
  token: string,
  roomIds: string[],
): Promise<string | null> {
  if (token === baseToken) return null;
  for (const roomId of roomIds) {
    if ((await roomTokenVariant(baseToken, roomId)) === token) return roomId;
  }
  return null;
}

export function registrationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/tr/${token}`;
}

export function teamEditUrl(origin: string, token: string, code: string): string {
  return `${registrationUrl(origin, token)}/${code}`;
}
