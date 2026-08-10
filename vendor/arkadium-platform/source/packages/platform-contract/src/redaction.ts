const SENSITIVE_KEY =
  /(?:auth(?:orization)?|credential|email|password|secret|session[-_]?id|token|user[-_]?id)/i;

export function redactAnalyticsProperties(value: unknown): unknown {
  return redact(value, new WeakSet<object>());
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[REDACTED]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(nested, seen);
  }
  return result;
}
