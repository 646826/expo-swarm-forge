import { validateRuntimeManifest } from '../../../../packages/integration-config/src/index.js';

const EXPECTED_OFFICIAL_SDK_VERSION = '2.66.2';
const SAVE_LIMIT_BYTES = 262_144;

function levelNumberForId(levelId) {
  if (typeof levelId !== 'string' || !/^[1-9]\d{0,8}$/.test(levelId)) {
    throw new TypeError('Arkadium level ID must be a canonical positive decimal number.');
  }
  const value = Number(levelId);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('Arkadium level ID is outside the supported range.');
  }
  return value;
}

function validateDependencies(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Official Arkadium platform dependencies are required.');
  }
  if (typeof value.OfficialArkadiumSdkBridge !== 'function') {
    throw new TypeError('Official Arkadium SDK bridge constructor is unavailable.');
  }
  if (typeof value.ArkadiumPublisherPlatform !== 'function') {
    throw new TypeError('Arkadium publisher platform constructor is unavailable.');
  }
  if (value.officialSdkVersion !== EXPECTED_OFFICIAL_SDK_VERSION) {
    throw new Error('Official Arkadium SDK version does not match the reviewed release.');
  }
  return value;
}

/**
 * Pure construction seam used by tests and by the tiny TypeScript runtime
 * wrapper. Optional capabilities remain disabled because no title-specific
 * policy is supplied here; later tasks add only policies backed by real
 * publisher configuration and evidence.
 */
export function createOfficialPlatformWithDependencies(
  { manifest } = {},
  dependencies,
) {
  let validatedManifest;
  try {
    validatedManifest = validateRuntimeManifest(manifest);
  } catch {
    throw new Error('Runtime configuration is invalid for the official Arkadium platform.');
  }

  if (validatedManifest.mode === 'standalone') {
    throw new Error('Official Arkadium platform requires a publisher mode.');
  }

  const reviewed = validateDependencies(dependencies);
  try {
    const bridge = new reviewed.OfficialArkadiumSdkBridge({
      environment: validatedManifest.arkadiumEnvironment,
      fallbackLocale: 'en-US',
      levelNumberForId,
    });
    return new reviewed.ArkadiumPublisherPlatform(bridge, {
      saveLimitBytes: SAVE_LIMIT_BYTES,
    });
  } catch {
    throw new Error('Unable to create the official Arkadium platform.');
  }
}

export {
  EXPECTED_OFFICIAL_SDK_VERSION,
  SAVE_LIMIT_BYTES,
  levelNumberForId,
};
