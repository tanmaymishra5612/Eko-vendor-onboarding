/**
 * worker.js
 * Orchestrates one onboarding submission through the full workflow:
 *
 *   RECEIVED -> VALIDATED -> RISK_SCORED -> DECIDED -> SUMMARIZED -> LOGGED
 *
 * DECIDED is one of: AUTO_APPROVED | PENDING_INFO | ESCALATED
 * The worker never outputs a fourth, terminal "REJECTED" state — rejecting
 * a partner outright is a human call, by design (see Constraints in README).
 */

const { validate } = require("./validator");
const { scoreRisk, RISK_THRESHOLD_ESCALATE } = require("./riskEngine");
const { generateSummary } = require("./summarizer");
const { redactSubmission, logEvent, toAggregateMetric } = require("./logger");

function decide(validation, risk) {
  // Incomplete/malformed always needs more info from the vendor first,
  // regardless of risk score — we can't risk-score fields that aren't there.
  if (!validation.isComplete || validation.malformed.length > 0) return "PENDING_INFO";
  // Complete submissions: only genuinely low-risk ones are auto-approved.
  // Medium and high risk both go to a human — they differ in urgency, not
  // in whether a human is needed.
  if (risk.band !== "low") return "ESCALATED";
  return "AUTO_APPROVED";
}

async function processSubmission(submission) {
  if (!submission || typeof submission !== "object") {
    // Hard failure case: input is not usable at all. Escalate immediately
    // rather than guessing at intent.
    const result = {
      decision: "ESCALATED",
      escalationReason: "submission payload missing or unreadable",
      validation: { isComplete: false, missing: ["<entire payload>"], malformed: [] },
      risk: { score: 100, band: "high", reasons: ["unreadable input"] },
      summary: "Submission could not be read. Escalated to a human reviewer without further processing.",
      summarySource: "system",
      states: ["RECEIVED", "ESCALATED"],
    };
    logEvent({ type: "onboarding_decision", submissionId: "unknown", ...toAggregateMetric(result) });
    return result;
  }

  const trace = { submissionId: submission.id || "unknown", states: ["RECEIVED"] };
  const validation = validate(submission);
  trace.states.push("VALIDATED");

  const risk = scoreRisk(submission, validation);
  trace.states.push("RISK_SCORED");

  const decision = decide(validation, risk);
  trace.states.push("DECIDED:" + decision);

  const preliminary = { validation, risk, decision };
  const { text: summary, source: summarySource, reason: summaryFailureReason } = await generateSummary(
    submission,
    preliminary
  );
  trace.states.push("SUMMARIZED" + (summarySource === "template" ? ":FALLBACK" : ""));

  const result = {
    decision,
    validation,
    risk,
    summary,
    summarySource,
    summaryFailureReason,
    escalationReason:
      decision === "ESCALATED"
        ? risk.reasons.join("; ")
        : decision === "PENDING_INFO"
        ? "missing or malformed required fields"
        : null,
    states: trace.states,
  };

  logEvent({
    type: "onboarding_decision",
    submissionId: trace.submissionId,
    redactedSubmission: redactSubmission(submission),
    ...toAggregateMetric(result),
    summaryFailureReason: summaryFailureReason || undefined,
  });
  trace.states.push("LOGGED");

  return result;
}

module.exports = { processSubmission, decide };
