export const PLATFORM_ERROR_CODES = {
  DESTROYED: 'DESTROYED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_LIFECYCLE: 'INVALID_LIFECYCLE',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  SAVE_TOO_LARGE: 'SAVE_TOO_LARGE',
  SDK_FAILURE: 'SDK_FAILURE',
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY',
} as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[keyof typeof PLATFORM_ERROR_CODES];

export interface PlatformError {
  readonly code: PlatformErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PlatformError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: PlatformErrorCode,
  message: string,
  recoverable = true,
): Result<T> {
  return { ok: false, error: { code, message, recoverable } };
}

export function sdkFailure<T = never>(): Result<T> {
  return err('SDK_FAILURE', 'Publisher SDK operation failed.', true);
}
