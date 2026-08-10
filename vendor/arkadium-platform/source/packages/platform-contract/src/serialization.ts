import { err, ok, type Result } from './result.ts';
import type { SerializableValue } from './types.ts';

export const DEFAULT_SAVE_LIMIT_BYTES = 512_000;

export function jsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Value is not JSON serializable.');
  }
  return new TextEncoder().encode(serialized).byteLength;
}

export function validateSavePayload<T extends SerializableValue>(
  value: T,
  limitBytes = DEFAULT_SAVE_LIMIT_BYTES,
): Result<{ readonly bytes: number }> {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 1) {
    return err('INVALID_ARGUMENT', 'Save limit must be a positive safe integer.', false);
  }

  let bytes: number;
  try {
    bytes = jsonByteLength(value);
  } catch {
    return err('INVALID_ARGUMENT', 'Save payload must be JSON serializable.', false);
  }

  if (bytes > limitBytes) {
    return err(
      'SAVE_TOO_LARGE',
      `Save payload is ${bytes} bytes; limit is ${limitBytes} bytes.`,
      false,
    );
  }
  return ok({ bytes });
}
