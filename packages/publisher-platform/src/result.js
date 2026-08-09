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

export function failure(code, message) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message }),
  });
}

export const PLATFORM_FAILURES = Object.freeze({
  notInitialized: failure('NOT_INITIALIZED', 'Publisher platform is not initialized.'),
  destroyed: failure('PLATFORM_DESTROYED', 'Publisher platform has been destroyed.'),
  unsupported: failure('UNSUPPORTED_CAPABILITY', 'Publisher capability is not available.'),
  invalidArgument: failure('INVALID_ARGUMENT', 'Publisher operation received an invalid argument.'),
});
