function canonicalizeValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValue).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeValue(record[key])}`)
    .join(',')}}`;
}

export function canonicalizeJson(value: unknown): string {
  return canonicalizeValue(value);
}

export async function sha256CanonicalJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
