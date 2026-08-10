export type ArkadiumRpcDiagnosticEnvironment = 'DEV' | 'STAGING';
export type ArkadiumRpcPhase = 'request' | 'response' | 'callback';
export type ArkadiumRpcTargetState = 'parent' | 'same-window' | 'missing';

export interface ArkadiumRpcDiagnosticsPolicy {
  readonly buildSha: string;
  readonly allowedOperations: readonly string[];
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export interface ArkadiumRpcDiagnosticsContext {
  readonly environment: 'DEV' | 'STAGING' | 'PROD';
  readonly sdkVersion: string;
}

export interface ArkadiumRpcTraceInput {
  readonly requestId: string;
  readonly operation: string;
  readonly phase: ArkadiumRpcPhase;
  readonly targetState?: ArkadiumRpcTargetState;
  readonly timestampMs?: number;
  readonly payload?: unknown;
}

export type ArkadiumRpcViolationCode =
  | 'UNKNOWN_OPERATION'
  | 'INVALID_REQUEST_ID'
  | 'INVALID_TIMESTAMP'
  | 'NON_MONOTONIC_TIMESTAMP'
  | 'DUPLICATE_REQUEST'
  | 'MISSING_REQUEST'
  | 'OPERATION_MISMATCH'
  | 'INVALID_TARGET'
  | 'SAME_WINDOW_TARGET'
  | 'DUPLICATE_RESPONSE'
  | 'DUPLICATE_CALLBACK'
  | 'CALLBACK_BEFORE_RESPONSE'
  | 'MISSING_RESPONSE'
  | 'UNRESOLVED_CALLBACK'
  | 'TIMEOUT';

export interface ArkadiumRpcViolation {
  readonly code: ArkadiumRpcViolationCode;
  readonly traceId?: string;
  readonly operation?: string;
}

export interface ArkadiumRpcTraceEvidence {
  readonly traceId: string;
  readonly operation: string;
  readonly targetState?: ArkadiumRpcTargetState;
  readonly startedAtMs?: number;
  readonly respondedAtMs?: number;
  readonly callbackAtMs?: number;
  readonly durationMs?: number;
  readonly payloadItemCounts: Readonly<{
    request?: number;
    response?: number;
    callback?: number;
  }>;
}

export interface ArkadiumRpcDiagnosticEvidence {
  readonly schemaVersion: 1;
  readonly buildSha: string;
  readonly sdkVersion: string;
  readonly environment: ArkadiumRpcDiagnosticEnvironment;
  readonly generatedAtMs: number;
  readonly status: 'PASS' | 'FAIL';
  readonly summary: Readonly<{
    requests: number;
    responses: number;
    callbacks: number;
    timeouts: number;
    violations: number;
  }>;
  readonly traces: readonly ArkadiumRpcTraceEvidence[];
  readonly violations: readonly ArkadiumRpcViolation[];
}

export interface ArkadiumRpcEvidenceVerificationOptions {
  readonly expectedBuildSha: string;
  readonly expectedSdkVersion: string;
  readonly nowMs: number;
  readonly maxAgeMs: number;
}

export interface ArkadiumRpcEvidenceVerificationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

interface MutableTrace {
  readonly traceId: string;
  readonly requestId: string;
  readonly operation: string;
  targetState?: ArkadiumRpcTargetState;
  requestAtMs?: number;
  responseAtMs?: number;
  callbackAtMs?: number;
  readonly payloadItemCounts: Partial<Record<ArkadiumRpcPhase, number>>;
}

const BUILD_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SDK_VERSION_PATTERN = /^2\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const OPERATION_PATTERN = /^[a-z][a-zA-Z0-9._:-]{1,79}$/;
const DEFAULT_TIMEOUT_MS = 5_000;
const FORBIDDEN_EVIDENCE_KEYS = new Set([
  'payload',
  'profile',
  'save',
  'token',
  'credential',
  'credentials',
  'appId',
  'transactionId',
  'requestId',
]);

export class ArkadiumRpcDiagnostics {
  readonly buildSha: string;
  readonly sdkVersion: string;
  readonly environment: ArkadiumRpcDiagnosticEnvironment;

  #allowedOperations: ReadonlySet<string>;
  #timeoutMs: number;
  #now: () => number;
  #tracesByRequestId = new Map<string, MutableTrace>();
  #traces: MutableTrace[] = [];
  #violations: ArkadiumRpcViolation[] = [];
  #violationKeys = new Set<string>();
  #lastTimestampMs: number | undefined;
  #active = false;

  constructor(policy: ArkadiumRpcDiagnosticsPolicy, context: ArkadiumRpcDiagnosticsContext) {
    if (context.environment !== 'DEV' && context.environment !== 'STAGING') {
      throw new Error('Arkadium RPC diagnostics are allowed only in DEV or STAGING.');
    }
    if (!BUILD_SHA_PATTERN.test(policy.buildSha)) {
      throw new Error('Arkadium RPC diagnostics require a lowercase 40-character build SHA.');
    }
    if (!SDK_VERSION_PATTERN.test(context.sdkVersion)) {
      throw new Error('Arkadium RPC diagnostics require an exact SDK version.');
    }
    const operations = policy.allowedOperations.map((value) => value.trim());
    if (
      operations.length === 0 ||
      operations.some((value) => !OPERATION_PATTERN.test(value)) ||
      new Set(operations).size !== operations.length
    ) {
      throw new Error('Arkadium RPC diagnostics require unique valid operation names.');
    }
    const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Arkadium RPC diagnostics timeout must be a positive safe integer.');
    }

    this.buildSha = policy.buildSha;
    this.sdkVersion = context.sdkVersion;
    this.environment = context.environment;
    this.#allowedOperations = new Set(operations);
    this.#timeoutMs = timeoutMs;
    this.#now = policy.now ?? Date.now;
  }

  get isActive(): boolean {
    return this.#active;
  }

  async activate(debugMode: (enabled: boolean) => unknown | Promise<unknown>): Promise<void> {
    if (this.#active) return;
    try {
      await debugMode(true);
    } catch {
      throw new Error('Unable to enable Arkadium RPC diagnostics.');
    }
    this.#active = true;
  }

  async deactivate(debugMode: (enabled: boolean) => unknown | Promise<unknown>): Promise<void> {
    if (!this.#active) return;
    try {
      await debugMode(false);
    } catch {
      throw new Error('Unable to disable Arkadium RPC diagnostics.');
    }
    this.#active = false;
  }

  record(input: ArkadiumRpcTraceInput): void {
    const timestampMs = input.timestampMs ?? this.#now();
    const requestId = input.requestId.trim();
    const operation = input.operation.trim();

    if (!this.#allowedOperations.has(operation)) {
      this.#addViolation('UNKNOWN_OPERATION', undefined, operation);
    }
    if (requestId.length === 0 || requestId.length > 256) {
      this.#addViolation('INVALID_REQUEST_ID', undefined, operation);
      return;
    }
    if (!Number.isFinite(timestampMs) || timestampMs < 0) {
      this.#addViolation('INVALID_TIMESTAMP', undefined, operation);
      return;
    }
    if (this.#lastTimestampMs !== undefined && timestampMs < this.#lastTimestampMs) {
      const existing = this.#tracesByRequestId.get(requestId);
      this.#addViolation('NON_MONOTONIC_TIMESTAMP', existing?.traceId, operation);
    }
    this.#lastTimestampMs = Math.max(this.#lastTimestampMs ?? timestampMs, timestampMs);

    if (input.phase === 'request') {
      this.#recordRequest(input, requestId, operation, timestampMs);
      return;
    }

    const trace = this.#tracesByRequestId.get(requestId);
    if (!trace) {
      this.#addViolation('MISSING_REQUEST', undefined, operation);
      return;
    }
    if (trace.operation !== operation) {
      this.#addViolation('OPERATION_MISMATCH', trace.traceId, operation);
      return;
    }

    if (input.phase === 'response') {
      if (trace.responseAtMs !== undefined) {
        this.#addViolation('DUPLICATE_RESPONSE', trace.traceId, operation);
        return;
      }
      trace.responseAtMs = timestampMs;
      trace.payloadItemCounts.response = countPayloadItems(input.payload);
      return;
    }

    if (trace.callbackAtMs !== undefined) {
      this.#addViolation('DUPLICATE_CALLBACK', trace.traceId, operation);
      return;
    }
    if (trace.responseAtMs === undefined) {
      this.#addViolation('CALLBACK_BEFORE_RESPONSE', trace.traceId, operation);
    }
    trace.callbackAtMs = timestampMs;
    trace.payloadItemCounts.callback = countPayloadItems(input.payload);
  }

  finalize(nowMs = this.#now()): ArkadiumRpcDiagnosticEvidence {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      throw new Error('Arkadium RPC diagnostics finalization time must be finite and non-negative.');
    }

    let timeoutCount = 0;
    for (const trace of this.#traces) {
      if (trace.requestAtMs === undefined) continue;
      if (trace.responseAtMs === undefined) {
        if (nowMs - trace.requestAtMs >= this.#timeoutMs) {
          timeoutCount += 1;
          this.#addViolation('TIMEOUT', trace.traceId, trace.operation);
        } else {
          this.#addViolation('MISSING_RESPONSE', trace.traceId, trace.operation);
        }
        continue;
      }
      if (trace.callbackAtMs === undefined) {
        this.#addViolation('UNRESOLVED_CALLBACK', trace.traceId, trace.operation);
      }
    }

    const traces = this.#traces.map((trace): ArkadiumRpcTraceEvidence => {
      const chronological =
        trace.requestAtMs !== undefined &&
        trace.responseAtMs !== undefined &&
        trace.callbackAtMs !== undefined &&
        trace.requestAtMs <= trace.responseAtMs &&
        trace.responseAtMs <= trace.callbackAtMs;
      return Object.freeze({
        traceId: trace.traceId,
        operation: trace.operation,
        ...(trace.targetState === undefined ? {} : { targetState: trace.targetState }),
        ...(trace.requestAtMs === undefined ? {} : { startedAtMs: trace.requestAtMs }),
        ...(trace.responseAtMs === undefined ? {} : { respondedAtMs: trace.responseAtMs }),
        ...(trace.callbackAtMs === undefined ? {} : { callbackAtMs: trace.callbackAtMs }),
        ...(chronological ? { durationMs: trace.callbackAtMs! - trace.requestAtMs! } : {}),
        payloadItemCounts: Object.freeze({ ...trace.payloadItemCounts }),
      });
    });
    const violations = this.#violations.map((value) => Object.freeze({ ...value }));
    const evidence: ArkadiumRpcDiagnosticEvidence = Object.freeze({
      schemaVersion: 1,
      buildSha: this.buildSha,
      sdkVersion: this.sdkVersion,
      environment: this.environment,
      generatedAtMs: nowMs,
      status: violations.length === 0 ? 'PASS' : 'FAIL',
      summary: Object.freeze({
        requests: this.#traces.filter((trace) => trace.requestAtMs !== undefined).length,
        responses: this.#traces.filter((trace) => trace.responseAtMs !== undefined).length,
        callbacks: this.#traces.filter((trace) => trace.callbackAtMs !== undefined).length,
        timeouts: timeoutCount,
        violations: violations.length,
      }),
      traces: Object.freeze(traces),
      violations: Object.freeze(violations),
    });
    return evidence;
  }

  #recordRequest(
    input: ArkadiumRpcTraceInput,
    requestId: string,
    operation: string,
    timestampMs: number,
  ): void {
    const existing = this.#tracesByRequestId.get(requestId);
    if (existing) {
      this.#addViolation('DUPLICATE_REQUEST', existing.traceId, operation);
      return;
    }

    const trace: MutableTrace = {
      traceId: `rpc-${this.#traces.length + 1}`,
      requestId,
      operation,
      ...(input.targetState === undefined ? {} : { targetState: input.targetState }),
      requestAtMs: timestampMs,
      payloadItemCounts: { request: countPayloadItems(input.payload) },
    };
    this.#traces.push(trace);
    this.#tracesByRequestId.set(requestId, trace);

    if (input.targetState === 'same-window') {
      this.#addViolation('SAME_WINDOW_TARGET', trace.traceId, operation);
    } else if (input.targetState !== 'parent') {
      this.#addViolation('INVALID_TARGET', trace.traceId, operation);
    }
  }

  #addViolation(code: ArkadiumRpcViolationCode, traceId?: string, operation?: string): void {
    const key = `${code}\0${traceId ?? ''}\0${operation ?? ''}`;
    if (this.#violationKeys.has(key)) return;
    this.#violationKeys.add(key);
    this.#violations.push(
      Object.freeze({
        code,
        ...(traceId === undefined ? {} : { traceId }),
        ...(operation === undefined ? {} : { operation }),
      }),
    );
  }
}

export function verifyArkadiumRpcDiagnosticEvidence(
  value: unknown,
  options: ArkadiumRpcEvidenceVerificationOptions,
): ArkadiumRpcEvidenceVerificationResult {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['RPC diagnostics evidence must be an object.'] };
  }

  if (value.schemaVersion !== 1) errors.push('RPC diagnostics schemaVersion must be 1.');
  if (value.buildSha !== options.expectedBuildSha) {
    errors.push('RPC diagnostics build SHA does not match the candidate.');
  }
  if (value.sdkVersion !== options.expectedSdkVersion) {
    errors.push('RPC diagnostics SDK version does not match the candidate.');
  }
  if (value.environment !== 'DEV' && value.environment !== 'STAGING') {
    errors.push('RPC diagnostics environment must be DEV or STAGING.');
  }
  if (value.status !== 'PASS') errors.push('RPC diagnostics evidence status must be PASS.');
  if (typeof value.generatedAtMs !== 'number' || !Number.isFinite(value.generatedAtMs)) {
    errors.push('RPC diagnostics generatedAtMs must be finite.');
  } else {
    if (value.generatedAtMs > options.nowMs) errors.push('RPC diagnostics evidence is from the future.');
    if (options.nowMs - value.generatedAtMs > options.maxAgeMs) {
      errors.push('RPC diagnostics evidence is stale.');
    }
  }
  if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 0) {
    errors.push('RPC diagnostics maxAgeMs must be a non-negative safe integer.');
  }
  if (!Array.isArray(value.traces) || !Array.isArray(value.violations)) {
    errors.push('RPC diagnostics traces and violations must be arrays.');
  }
  if (Array.isArray(value.violations) && value.violations.length !== 0) {
    errors.push('RPC diagnostics PASS evidence must contain no violations.');
  }
  collectForbiddenEvidenceKeys(value, errors);
  return { ok: errors.length === 0, errors };
}

function countPayloadItems(payload: unknown): number {
  if (payload === undefined || payload === null) return 0;
  if (Array.isArray(payload)) return payload.length;
  if (typeof payload !== 'object') return 1;
  return Object.values(Object.getOwnPropertyDescriptors(payload)).filter(
    (descriptor) => descriptor.enumerable,
  ).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function collectForbiddenEvidenceKeys(value: unknown, errors: string[], seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (FORBIDDEN_EVIDENCE_KEYS.has(key)) {
      errors.push(`RPC diagnostics evidence contains forbidden field ${key}.`);
    }
    if ('value' in descriptor) collectForbiddenEvidenceKeys(descriptor.value, errors, seen);
  }
}
