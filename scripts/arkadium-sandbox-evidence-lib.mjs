import {
  DEFAULT_SANDBOX_RPC_OPERATIONS,
  SANDBOX_RELEASE_STATES,
  sha256Pattern,
  verifySandboxEvidence as verifySandboxEvidenceCore,
  verifySandboxEvidenceBundle as verifySandboxEvidenceBundleCore,
  verifySandboxEvidenceDirectory as verifySandboxEvidenceDirectoryCore,
} from './arkadium-sandbox-evidence-core.mjs';

export {
  DEFAULT_SANDBOX_RPC_OPERATIONS,
  SANDBOX_RELEASE_STATES,
  sha256Pattern,
};

const MAX_STRUCTURE_DEPTH = 12;
const MAX_STRUCTURE_FIELDS = 1_024;
const UNSAFE_EVIDENCE_REPORT = Object.freeze({
  ok: false,
  releaseState: 'contract-ready',
  errors: Object.freeze(['Sandbox evidence contains unsafe object structure.']),
  summary: Object.freeze({}),
});

/**
 * Inspects descriptors rather than property values so accessors, symbols,
 * hidden fields, cyclic objects and exotic prototypes are rejected before
 * the core schema verifier can read any evidence property.
 */
function hasUnsafeStructure(value, seen = new Set(), depth = 0) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return false;
  if (typeof value !== 'object' || depth > MAX_STRUCTURE_DEPTH || seen.has(value)) return true;
  if (Object.getOwnPropertySymbols(value).length > 0) return true;

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (isArray) {
    if (prototype !== Array.prototype) return true;
  } else if (prototype !== Object.prototype && prototype !== null) {
    return true;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = Object.entries(descriptors).filter(([key]) => !isArray || key !== 'length');
  if (entries.length > MAX_STRUCTURE_FIELDS) return true;

  seen.add(value);
  for (const [, descriptor] of entries) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return true;
    if (hasUnsafeStructure(descriptor.value, seen, depth + 1)) return true;
  }
  seen.delete(value);
  return false;
}

function assertSafeOptions(options) {
  if (hasUnsafeStructure(options)) {
    throw new TypeError('Sandbox evidence verification options are invalid.');
  }
}

/**
 * Adds the two already-validated host lifecycle observations to the compact
 * combined-evidence summary without weakening the core schema verifier.
 */
export function verifySandboxEvidence(input, options = {}) {
  if (hasUnsafeStructure(input)) return UNSAFE_EVIDENCE_REPORT;
  assertSafeOptions(options);
  const report = verifySandboxEvidenceCore(input, options);
  if (!report.ok) return report;
  return Object.freeze({
    ...report,
    summary: Object.freeze({
      ...report.summary,
      hostPauseObserved: true,
      hostResumeObserved: true,
    }),
  });
}

export function verifySandboxEvidenceBundle(bundle, options = {}) {
  if (hasUnsafeStructure(bundle)) return UNSAFE_EVIDENCE_REPORT;
  assertSafeOptions(options);
  return verifySandboxEvidenceBundleCore(bundle, options);
}

export function verifySandboxEvidenceDirectory(directory, options = {}) {
  assertSafeOptions(options);
  return verifySandboxEvidenceDirectoryCore(directory, options);
}
