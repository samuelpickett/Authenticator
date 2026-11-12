// AI-generated code

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Returns the comparison key used for case-insensitive username uniqueness. */
export function usernameKey(username: string): string {
  return username.normalize('NFKC').toLowerCase();
}

/** Validates a visible username while allowing ordinary Unicode and emoji. */
export function validateUsername(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim() || !value.trim()) return null;
  if (Buffer.byteLength(value, 'utf8') > 256) return null;
  const clusters = [...graphemes.segment(value)];
  if (clusters.length < 1 || clusters.length > 32) return null;
  if (/\p{Cc}|\p{Cs}|\p{Zl}|\p{Zp}/u.test(value)) return null;
  // Permit invisible code points only inside supported emoji clusters.
  for (const cluster of clusters) {
    const pictographs = [...cluster.segment.matchAll(/\p{Extended_Pictographic}/gu)].length;
    for (const character of cluster.segment) {
      if (!/\p{Default_Ignorable_Code_Point}/u.test(character)) continue;
      if (character === '\u200D' && pictographs >= 2) continue;
      if ((character === '\uFE0E' || character === '\uFE0F') && pictographs >= 1) continue;
      return null;
    }
    if (!/[\p{L}\p{N}\p{P}\p{S}\p{Zs}]/u.test(cluster.segment)) return null;
  }
  return value.normalize('NFC');
}

/** Returns a stable comparison key for an email address under this module's policy. */
export function emailKey(email: string): string {
  return email.normalize('NFC').toLowerCase();
}

/** Accepts a practical email address without provider-specific rewrites. */
export function validateEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().normalize('NFC');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return null;
  return email;
}

/** Enforces the single-factor password length and a bounded request size. */
export function validatePassword(value: unknown): value is string {
  return typeof value === 'string' && [...value].length >= 15 && Buffer.byteLength(value, 'utf8') <= 1024;
}
