import type { getInstance as getOfficialArkadiumSdkInstance } from '@arkadiuminc/sdk';

import sdkSnapshotManifest from '../sdk/manifest.json' with { type: 'json' };

export type ArkadiumSdkEnvironment = 'DEV' | 'STAGING' | 'PROD';
type OfficialArkadiumSdkGetInstance = typeof getOfficialArkadiumSdkInstance;
type OfficialArkadiumSdkEnvironmentValue = NonNullable<
  Parameters<OfficialArkadiumSdkGetInstance>[0]
>;

export type OfficialArkadiumSdk = Awaited<ReturnType<OfficialArkadiumSdkGetInstance>>;
export interface OfficialArkadiumSdkModule {
  readonly Env: Readonly<
    Record<ArkadiumSdkEnvironment, OfficialArkadiumSdkEnvironmentValue>
  >;
  readonly getInstance: OfficialArkadiumSdkGetInstance;
}
export type OfficialArkadiumSdkLoader = (
  environment: ArkadiumSdkEnvironment,
) => Promise<OfficialArkadiumSdk>;

export const OFFICIAL_ARKADIUM_SDK_VERSION = sdkSnapshotManifest.package.version;

export function createOfficialArkadiumSdkLoader(
  importModule: () => Promise<OfficialArkadiumSdkModule> = () => import('@arkadiuminc/sdk'),
): OfficialArkadiumSdkLoader {
  return async (environment) => {
    let sdkModule: OfficialArkadiumSdkModule;
    try {
      sdkModule = await importModule();
    } catch {
      throw new Error('Unable to load the official Arkadium SDK module.');
    }

    const sdkEnvironment = sdkModule.Env[environment];
    if (typeof sdkEnvironment !== 'string') {
      throw new Error(`Official Arkadium SDK does not expose environment ${environment}.`);
    }

    let sdk: OfficialArkadiumSdk;
    try {
      sdk = await sdkModule.getInstance(sdkEnvironment);
    } catch {
      throw new Error('Unable to initialize the official Arkadium SDK.');
    }

    if (sdk.version !== OFFICIAL_ARKADIUM_SDK_VERSION) {
      throw new Error('Arkadium SDK runtime version does not match committed snapshot.');
    }

    return sdk;
  };
}

export const loadOfficialArkadiumSdk = createOfficialArkadiumSdkLoader();
