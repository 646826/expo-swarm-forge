import { err, ok, type Result } from './result.ts';

export type LifecycleState = 'new' | 'initialized' | 'ready' | 'started' | 'ended' | 'destroyed';

export class LifecycleGuard {
  #state: LifecycleState = 'new';

  get state(): LifecycleState {
    return this.#state;
  }

  assertState(...allowed: readonly LifecycleState[]): Result<void> {
    if (this.#state === 'destroyed') {
      return err('DESTROYED', 'Platform has been destroyed.', false);
    }
    if (!allowed.includes(this.#state)) {
      return err(
        'INVALID_LIFECYCLE',
        `Lifecycle state ${this.#state} is not valid for this operation.`,
        false,
      );
    }
    return ok(undefined);
  }

  markInitialized(): Result<void> {
    return this.#transition(['new'], 'initialized');
  }

  markReady(): Result<void> {
    return this.#transition(['initialized'], 'ready');
  }

  markGameStarted(): Result<void> {
    return this.#transition(['ready'], 'started');
  }

  markGameEnded(): Result<void> {
    return this.#transition(['started'], 'ended');
  }

  assertGameplayActive(): Result<void> {
    return this.assertState('started');
  }

  markDestroyed(): Result<void> {
    if (this.#state === 'destroyed') {
      return err('DESTROYED', 'Platform has already been destroyed.', false);
    }
    this.#state = 'destroyed';
    return ok(undefined);
  }

  #transition(allowed: readonly LifecycleState[], next: LifecycleState): Result<void> {
    const current = this.assertState(...allowed);
    if (!current.ok) return current;
    this.#state = next;
    return ok(undefined);
  }
}
