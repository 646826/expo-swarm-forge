import { verifySandboxEvidence as verifySandboxEvidenceCore } from './arkadium-sandbox-evidence-core.mjs';

export {
  DEFAULT_SANDBOX_RPC_OPERATIONS,
  SANDBOX_RELEASE_STATES,
  sha256Pattern,
  verifySandboxEvidenceBundle,
  verifySandboxEvidenceDirectory,
} from './arkadium-sandbox-evidence-core.mjs';

/**
 * Adds the two already-validated host lifecycle observations to the compact
 * combined-evidence summary without weakening the core schema verifier.
 */
export function verifySandboxEvidence(input, options = {}) {
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
