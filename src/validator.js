/**
 * validator.js
 * Checks a partner/vendor onboarding submission for missing or malformed
 * required fields. Pure, deterministic, no external calls — this is the
 * first and cheapest gate in the workflow.
 */

const REQUIRED_FIELDS = [
  "businessName",
  "contactName",
  "contactPhone",
  "contactEmail",
  "serviceCategory",
  "address",
  "businessRegistrationNumber",
  "bankAccountNumber",
];

const PHONE_RE = /^\+?[0-9]{10,13}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Indian GST-style registration number, used only as a plausible format check
const REG_NUMBER_RE = /^[0-9A-Z]{10,15}$/;

function validate(submission) {
  const missing = [];
  const malformed = [];

  for (const field of REQUIRED_FIELDS) {
    const value = submission[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      missing.push(field);
    }
  }

  if (submission.contactPhone && !PHONE_RE.test(String(submission.contactPhone))) {
    malformed.push({ field: "contactPhone", reason: "does not look like a valid phone number" });
  }
  if (submission.contactEmail && !EMAIL_RE.test(String(submission.contactEmail))) {
    malformed.push({ field: "contactEmail", reason: "does not look like a valid email" });
  }
  if (
    submission.businessRegistrationNumber &&
    !REG_NUMBER_RE.test(String(submission.businessRegistrationNumber))
  ) {
    malformed.push({
      field: "businessRegistrationNumber",
      reason: "unexpected format (expected 10-15 alphanumeric chars)",
    });
  }
  if (
    submission.bankAccountNumber &&
    String(submission.bankAccountNumber).replace(/\D/g, "").length < 8
  ) {
    malformed.push({ field: "bankAccountNumber", reason: "too short to be a real account number" });
  }

  return {
    isComplete: missing.length === 0,
    missing,
    malformed,
    hasIssues: missing.length > 0 || malformed.length > 0,
  };
}

module.exports = { validate, REQUIRED_FIELDS };
