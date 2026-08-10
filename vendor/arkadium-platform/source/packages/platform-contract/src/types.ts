import type { Result } from './result.ts';

export type SerializablePrimitive = string | number | boolean | null;
export type SerializableValue =
  | SerializablePrimitive
  | readonly SerializableValue[]
  | { readonly [key: string]: SerializableValue };

export type UserState = 'anonymous' | 'registered' | 'subscriber';

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
