/**
 * logger.js
 * Every log line is redacted BEFORE it is written — not after. This is the
 * DPDP-relevant boundary of the whole system: raw PII (bank account numbers,
 * registration numbers, phone/email) never reaches disk. Only masked values,
 * decisions, and reasons are persisted, so the audit trail is safe to
 * inspect or export without itself becoming a new data-protection liability.
 */

const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "..", "logs", "audit.log");

function mask(value) {
  if (value === undefined || value === null) return value;
  const str = String(value);
  if (str.length <= 4) return "*".repeat(str.length);
  return str.slice(0, 2) + "*".repeat(str.length - 4) + str.slice(-2);
}

function redactSubmission(submission) {
  const redacted = { ...submission };
  if (redacted.bankAccountNumber) redacted.bankAccountNumber = mask(redacted.bankAccountNumber);
  if (redacted.businessRegistrationNumber)
    redacted.businessRegistrationNumber = mask(redacted.businessRegistrationNumber);
  if (redacted.contactPhone) redacted.contactPhone = mask(redacted.contactPhone);
  if (redacted.contactEmail) redacted.contactEmail = mask(redacted.contactEmail);
  return redacted;
}

function logEvent(event) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event });
  fs.appendFileSync(LOG_FILE, line + "\n");
  return line;
}

// Non-PII, aggregate-only shape — this is the ONLY thing that would ever be
// safe to forward upstream (e.g. to Eko) for product analytics.
function toAggregateMetric(result) {
  return {
    timestamp: new Date().toISOString(),
    decision: result.decision,
    riskBand: result.risk.band,
    riskScore: result.risk.score,
    missingFieldCount: result.validation.missing.length,
    malformedFieldCount: result.validation.malformed.length,
    summarySource: result.summarySource,
  };
}

module.exports = { redactSubmission, logEvent, toAggregateMetric, LOG_FILE };
