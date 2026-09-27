/**
 * riskEngine.js
 * Deterministic rule-based risk scoring. Deliberately NOT an ML model —
 * for a bounded compliance-adjacent workflow like onboarding, explainable
 * rules beat a black-box score, and every point added below is traceable
 * to a stated reason (needed for the audit log and for human review).
 */

const RISK_THRESHOLD_ESCALATE = 50;
const RISK_THRESHOLD_REVIEW = 25;

function scoreRisk(submission, validation) {
  let score = 0;
  const reasons = [];

  if (validation.missing.length > 0) {
    score += validation.missing.length * 15;
    reasons.push(`${validation.missing.length} required field(s) missing`);
  }
  if (validation.malformed.length > 0) {
    score += validation.malformed.length * 10;
    reasons.push(`${validation.malformed.length} field(s) fail format checks`);
  }
  if (!submission.documentsUploaded || submission.documentsUploaded.length === 0) {
    score += 20;
    reasons.push("no supporting documents uploaded");
  }
  if (submission.serviceCategory && /pharma|financial|medical/i.test(submission.serviceCategory)) {
    score += 15;
    reasons.push("regulated service category requires extra scrutiny");
  }
  if (submission.claimedMonthlyVolume && Number(submission.claimedMonthlyVolume) > 100000) {
    score += 10;
    reasons.push("unusually high claimed monthly volume for a new partner");
  }

  score = Math.min(score, 100);

  let band = "low";
  if (score >= RISK_THRESHOLD_ESCALATE) band = "high";
  else if (score >= RISK_THRESHOLD_REVIEW) band = "medium";

  return { score, band, reasons };
}

module.exports = { scoreRisk, RISK_THRESHOLD_ESCALATE, RISK_THRESHOLD_REVIEW };
