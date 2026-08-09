export const PLATFORM_ERROR_CODES = Object.freeze({
  DESTROYED: 'DESTROYED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_LIFECYCLE: 'INVALID_LIFECYCLE',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  SAVE_TOO_LARGE: 'SAVE_TOO_LARGE',
  SDK_FAILURE: 'SDK_FAILURE',
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY',
});

export const NO_CAPABILITIES = Object.freeze({
  persistence: false,
  analytics: false,
  interstitialAds: false,
  rewardedAds: false,
  wallet: false,
  leaderboards: false,
});

export function ok(value) {
  return Object.freeze({ ok: true, value });
}

export function err(code, message, recoverable = true) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, recoverable }),
  });
}

export function sdkFailure() {
  return err('SDK_FAILURE', 'Publisher SDK operation failed.', true);
}
