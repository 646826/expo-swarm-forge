import {
  ArkadiumPublisherPlatform,
  OfficialArkadiumSdkBridge,
  OFFICIAL_ARKADIUM_SDK_VERSION,
} from '../../../../vendor/arkadium-platform/source/packages/platform-arkadium/src/index.ts';

import { createOfficialPlatformWithDependencies } from './official-platform-core.js';

export function createOfficialPlatform(options: Parameters<typeof createOfficialPlatformWithDependencies>[0]) {
  return createOfficialPlatformWithDependencies(options, {
    ArkadiumPublisherPlatform,
    OfficialArkadiumSdkBridge,
    officialSdkVersion: OFFICIAL_ARKADIUM_SDK_VERSION,
  });
}
