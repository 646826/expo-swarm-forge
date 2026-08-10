export type GameEventName =
  | 'sdk_initialize_started'
  | 'sdk_initialize_succeeded'
  | 'sdk_ready'
  | 'game_start'
  | 'level_start'
  | 'move_rejected'
  | 'move_accepted'
  | 'score_changed'
  | 'pause'
  | 'resume'
  | 'level_end'
  | 'game_end'
  | 'save_load'
  | 'save_write'
  | 'ad_request'
  | 'ad_result'
  | 'leaderboard_submit'
  | 'wallet_balance'
  | 'wallet_consume_result'
  | 'integration_error';

export type GameEventPrimitive = string | number | boolean | null;
export type GameEventProperties = Readonly<Record<string, GameEventPrimitive>>;

export interface CanonicalGameEvent {
  readonly eventId: string;
  readonly name: GameEventName;
  readonly version: 1;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly properties: GameEventProperties;
}

export interface GameEventDefinition {
  readonly version: 1;
  readonly routes: Readonly<{
    readonly arkadium: boolean;
    readonly gameEye: boolean;
  }>;
  readonly prodAllowed: boolean;
  readonly samplingAllowed: boolean;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface CanonicalEventFactoryOptions {
  readonly now: () => string;
  readonly createId: () => string;
}

export type CanonicalEventFactory = (
  name: GameEventName,
  properties?: GameEventProperties,
) => CanonicalGameEvent;

export type EventSinkRoute = 'arkadium' | 'gameEye';

export interface EventSink {
  readonly id: string;
  readonly route: EventSinkRoute;
  dispatch(event: CanonicalGameEvent): void | Promise<void>;
}

export interface EventDispatchFailure {
  readonly id: string;
  readonly code: 'SINK_DELIVERY_FAILED';
}

export interface EventDispatchResult {
  readonly delivered: readonly string[];
  readonly failed: readonly EventDispatchFailure[];
}

export interface EventDispatcher {
  dispatch(event: CanonicalGameEvent): Promise<EventDispatchResult>;
}

export const GAME_EVENT_NAMES: readonly GameEventName[];
export function getEventDefinition(name: GameEventName): GameEventDefinition;
export function validateCanonicalEvent(event: unknown): CanonicalGameEvent;
export function createCanonicalEventFactory(
  options: CanonicalEventFactoryOptions,
): CanonicalEventFactory;
export function createEventDispatcher(sinks?: readonly EventSink[]): EventDispatcher;
