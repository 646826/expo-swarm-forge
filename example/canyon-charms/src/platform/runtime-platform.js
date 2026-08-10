import { validateRuntimeManifest } from '../../../../packages/integration-config/src/index.js';
import { createStandalonePublisherPlatform } from '../../../../packages/publisher-platform/src/index.js';

async function defaultOfficialPlatformLoader() {
  return import('./official-platform.ts');
}

function validateManifest(input) {
  try {
    return validateRuntimeManifest(input);
  } catch {
    throw new Error('Runtime configuration is invalid.');
  }
}

/**
 * Selects the publisher implementation from an already public runtime
 * manifest. Standalone mode never imports the official SDK boundary. Publisher
 * modes fail closed: SDK load or factory failures cannot downgrade the build.
 */
export async function createRuntimePlatform(input, {
  createStandalonePlatform = createStandalonePublisherPlatform,
  loadOfficialPlatform = defaultOfficialPlatformLoader,
} = {}) {
  const manifest = validateManifest(input);

  if (manifest.mode === 'standalone') {
    if (typeof createStandalonePlatform !== 'function') {
      throw new Error('Standalone platform factory is unavailable.');
    }
    return createStandalonePlatform();
  }

  let officialModule;
  try {
    officialModule = await loadOfficialPlatform();
  } catch {
    throw new Error('Unable to load the official Arkadium platform module.');
  }

  if (typeof officialModule?.createOfficialPlatform !== 'function') {
    throw new Error('Official Arkadium platform module is invalid.');
  }

  try {
    return officialModule.createOfficialPlatform({ manifest });
  } catch {
    throw new Error('Unable to create the official Arkadium platform.');
  }
}
