export type SerializablePrimitive = string | number | boolean | null;
export type SerializableValue =
  | SerializablePrimitive
  | readonly SerializableValue[]
  | { readonly [key: string]: SerializableValue };

export type UserState = 'anonymous' | 'registered' | 'subscriber';
export type LifecycleState = 'new' | 'initialized' | 'ready' | 'started' | 'ended' | 'destroyed';

export declare const PLATFORM_ERROR_CODES: Readonly<{
  DESTROYED: 'DESTROYED';
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS';
  INVALID_ARGUMENT: 'INVALID_ARGUMENT';
  INVALID_LIFECYCLE: 'INVALID_LIFECYCLE';
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED';
  NOT_INITIALIZED: 'NOT_INITIALIZED';
  SAVE_TOO_LARGE: 'SAVE_TOO_LARGE';
  SDK_FAILURE: 'SDK_FAILURE';
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY';
}>;

export type PlatformErrorCode =
  (typeof PLATFORM_ERROR_CODES)[keyof typeof PLATFORM_ERROR_CODES];

export interface PlatformCapabilities {
  readonly persistence: boolean;
  readonly analytics: boolean;
  readonly interstitialAds: boolean;
  readonly rewardedAds: boolean;
  readonly wallet: boolean;
  readonly leaderboards: boolean;
}

export interface PlatformContext {
  readonly userState: UserState;
  readonly locale: string;
  readonly capabilities: PlatformCapabilities;
}

export interface PlatformError {
  readonly code: PlatformErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PlatformError };

export interface AnalyticsEvent {
  readonly name: string;
  readonly version?: number;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface AdResult {
  readonly shown: boolean;
}

export interface RewardedAdResult {
  readonly completed: boolean;
}

export interface WalletResult {
  readonly balance: number;
}

export interface LeaderboardSubmission {
  readonly board: string;
  readonly score: number;
  readonly metadata?: Readonly<Record<string, SerializableValue>>;
}

export interface PublisherPlatform {
  readonly capabilities: PlatformCapabilities;
  initialize(): Promise<Result<PlatformContext>>;
  signalReady(): Promise<Result<void>>;
  signalGameStart(): Promise<Result<void>>;
  signalScore(score: number): Promise<Result<void>>;
  signalLevelStart(levelId: string): Promise<Result<void>>;
  signalLevelEnd(levelId: string): Promise<Result<void>>;
  signalGameEnd(reason: string): Promise<Result<void>>;
  onPause(handler: () => void): () => void;
  onResume(handler: () => void): () => void;
  loadSave<T extends SerializableValue>(): Promise<Result<T | null>>;
  writeSave<T extends SerializableValue>(save: T): Promise<Result<void>>;
  track(event: AnalyticsEvent): Promise<Result<void>>;
  showInterstitial(placement: string): Promise<Result<AdResult>>;
  showRewarded(placement: string): Promise<Result<RewardedAdResult>>;
  getWalletBalance(): Promise<Result<number>>;
  consumeCurrency(amount: number, transactionId: string): Promise<Result<WalletResult>>;
  submitLeaderboard(entry: LeaderboardSubmission): Promise<Result<void>>;
  destroy(): Promise<void>;
}

export interface StandaloneEventSource {
  onPause(handler: () => void): () => void;
  onResume(handler: () => void): () => void;
}

export interface StandalonePlatformOptions {
  readonly locale?: string;
  readonly eventSource?: StandaloneEventSource;
}

export declare const NO_CAPABILITIES: Readonly<PlatformCapabilities>;
export declare function ok<T>(value: T): Result<T>;
export declare function err<T = never>(
  code: PlatformErrorCode,
  message: string,
  recoverable?: boolean,
): Result<T>;
export declare function sdkFailure<T = never>(): Result<T>;

export declare class LifecycleGuard {
  get state(): LifecycleState;
  assertState(...allowed: readonly LifecycleState[]): Result<void>;
  markInitialized(): Result<void>;
  markReady(): Result<void>;
  markGameStarted(): Result<void>;
  markGameEnded(): Result<void>;
  assertGameplayActive(): Result<void>;
  markDestroyed(): Result<void>;
}

export declare function createStandalonePublisherPlatform(
  options?: StandalonePlatformOptions,
): PublisherPlatform;
