export type PlatformMode =
  | 'standalone'
  | 'arkadium-sandbox'
  | 'arkadium-dev'
  | 'arkadium-prod';

export type ArkadiumEnvironment = 'DEV' | 'STAGING' | 'PROD';
export type AnalyticsProvider = 'none' | 'console' | 'app-insights';

export interface PublicRuntimeManifest {
  readonly schemaVersion: 1;
  readonly mode: PlatformMode;
  readonly arkadiumEnvironment: ArkadiumEnvironment | null;
  readonly gameId: string | null;
  readonly analyticsProvider: AnalyticsProvider;
  readonly appInsightsId: string | null;
  readonly gameEyeEndpoint: string | null;
  readonly gameEyeProject: 'canyon-charms';
  readonly gameVersion: string;
  readonly buildSha: string;
}

export interface RuntimeEnvironment {
  readonly GAME_MODE?: string;
  readonly ARKADIUM_ENV?: string;
  readonly ARKADIUM_GAME_ID?: string;
  readonly ARKADIUM_ANALYTICS_PROVIDER?: string;
  readonly ARKADIUM_APP_INSIGHTS_ID?: string;
  readonly GAME_EYE_ENDPOINT?: string;
  readonly GAME_EYE_PROJECT?: string;
  readonly GAME_VERSION?: string;
  readonly BUILD_SHA?: string;
  readonly [key: string]: string | undefined;
}

export declare const PLATFORM_MODES: readonly PlatformMode[];
export declare const ANALYTICS_PROVIDERS: readonly AnalyticsProvider[];
export declare function validateRuntimeManifest(input: unknown): PublicRuntimeManifest;
export declare function runtimeManifestFromEnv(env?: RuntimeEnvironment): PublicRuntimeManifest;
