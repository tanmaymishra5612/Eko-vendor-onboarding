# Partner/Vendor Onboarding Worker

A bounded AI Worker that takes a vendor onboarding submission, validates it,
scores its risk, decides how to route it, writes a privacy-safe audit log,
and produces a short human-readable summary — escalating anything incomplete
or risky to a human instead of guessing.

Inspired directly by backend onboarding/validation work on PaPaPet (a
booking/service platform), where this exact shape of problem — "is this
submission good enough to move forward automatically, or does a person need
to look at it?" — comes up constantly.

## Goal
Cut the time an operations reviewer spends on **every** vendor submission by
having the worker fully resolve the easy, low-risk, complete cases on its
own, and hand the reviewer only the submissions that actually need a human
judgment call — with the reasoning already laid out for them.

## User
An operations/onboarding reviewer at a marketplace or booking platform
(PaPaPet-shaped), who currently reads every new vendor submission manually.

## System
Sits inside the partner onboarding pipeline: vendor fills a form →
**this worker** validates + risk-scores + decides → downstream ops
dashboard/notification service acts on the decision. It's one stage in a
larger pipeline, not the whole pipeline.

## Inputs
A JSON submission: business name, contact details, service category,
address, business registration number, bank account number, uploaded
document list, claimed monthly volume. (See `data/sample_inputs.json`.)

## Outputs
A structured decision object: `decision`, `validation` (missing/malformed
fields), `risk` (score, band, reasons), a plain-English `summary`, and — for
non-approved cases — an `escalationReason`. Plus a redacted audit-log line.

## Decisions the worker can make
- **AUTO_APPROVED** — complete submission, low risk.
- **PENDING_INFO** — missing or malformed required fields; sent back to the
  vendor to fix, not to a human queue.
- **ESCALATED** — complete but medium/high risk (regulated category, no
  documents, unusually high claimed volume, etc.), or an unreadable payload.

## Constraints — what it must NOT do
- Never auto-**reject** a vendor outright. Worst case is escalate; banning a
  business is a human decision.
- Never write raw PII (bank account, registration number, phone, email) to
  any log. Redaction happens *before* the write, not after.
- Never call a paid external API with real customer PII — in this prototype
  the only external call is an optional LLM summary call, and it never
  receives bank details or registration numbers, only the already-computed
  decision + risk reasons.
- Never let a failure in the "nice to have" summary step swallow or delay
  the actual decision.

## Device constraint
Plain Node.js/Express, no GPU, no local model weights. Runs comfortably on
a low-end VM or even a laptop. The optional LLM call is the only network
dependency, and the system is explicitly designed to keep working — with a
lower-quality summary — if that call is slow, down, or unauthenticated.

## Definition of Done
A submission goes from `RECEIVED` to a logged, structured decision
(`AUTO_APPROVED` / `PENDING_INFO` / `ESCALATED`) with a human-readable
summary, in one synchronous call, for both well-formed and malformed input,
without throwing an unhandled error.

## Privacy / DPDP design
- **Stays local, never logged in raw form:** bank account number, business
  registration number, phone, email — masked (`mask()` in `src/logger.js`)
  before any write to the audit log.
- **Never sent anywhere:** the redaction happens before the log write, and
  the LLM prompt itself is built only from the business name and the
  already-computed decision/risk reasons — no bank or registration numbers
  are ever included in the LLM call.
- **What could flow upstream (e.g. to Eko) as aggregate product analytics:**
  only `toAggregateMetric()`'s shape — decision, risk band/score, counts of
  missing/malformed fields, which summary source was used. No names, no
  contact info, no account numbers, no business name.

## Escalation triggers
1. Risk band is medium or high on an otherwise complete submission.
2. Required fields missing or fail format validation → `PENDING_INFO` (sent
   back to vendor, not a human queue, but see "what remains human-led"
   below for why a human eventually reviews the resubmission too in a real
   deployment).
3. The payload itself is unreadable (`null`, wrong type) → immediate
   `ESCALATED`, no further processing attempted.

## Success metric
% of submissions that reach `AUTO_APPROVED` or a well-formed `PENDING_INFO`
without any human touch — i.e., how many of the "easy" cases actually get
fully handled by the worker instead of landing on a reviewer's desk. In this
demo, 1 of 4 samples is fully auto-approved, 1 is safely bounced back for
missing info, and 2 are correctly escalated (one for risk, one for
unreadable input) — none are silently mishandled.

## Workflow states and transitions
```
RECEIVED -> VALIDATED -> RISK_SCORED -> DECIDED:<AUTO_APPROVED|PENDING_INFO|ESCALATED> -> SUMMARIZED[:FALLBACK] -> LOGGED
```
An unreadable payload short-circuits straight to `RECEIVED -> ESCALATED`.

## Exception and failure handling
- **Malformed/unreadable input** (`null`, wrong type): short-circuits to an
  immediate `ESCALATED` decision instead of crashing. Demonstrated by sample
  4 in `data/sample_inputs.json`.
- **LLM summary API unavailable / no key / bad response**: `summarizer.js`
  catches every failure mode (network error, timeout, non-2xx, empty text)
  and falls back to a deterministic template. The `decision` is computed
  *before* the summary step and never depends on it — a summary failure
  degrades the prose, never the decision. Demonstrated live in every sample
  run in this repo, since no `ANTHROPIC_API_KEY` is configured.
- **Unexpected internal error in the HTTP layer**: `src/index.js` wraps the
  call in try/catch and returns a safe `ESCALATED` response rather than a
  raw 500.

## Logging / audit approach
Every decision writes one JSON line to `logs/audit.log`: timestamp,
submission ID, the *redacted* submission, decision, risk band/score, field
counts, and which summary source was used (and why, if it fell back). This
is the audit trail a compliance reviewer could read without it becoming a
new source of PII exposure.

## Sample inputs and outputs
Run `npm run demo` to regenerate. Real output from this repo, unedited:

| Submission | Decision | Risk | Notes |
|---|---|---|---|
| VEND-001 Rewa Fresh Mart | AUTO_APPROVED | 0 (low) | complete, low-risk grocery vendor |
| VEND-002 Quickfix Electronics | PENDING_INFO | 50 (high) | missing address + registration number |
| VEND-003 MediCare Pharma Distributors | ESCALATED | 45 (medium) | complete, but regulated category + no documents + high claimed volume |
| `null` payload | ESCALATED | 100 (high) | unreadable input, intentional failure case |

Full structured JSON for all four is in `demo_output.json` after running the
demo; the redacted audit trail is in `logs/audit.log`.

## Tool/API usage
- Express (HTTP layer only — `POST /onboarding/submit`, `GET /health`).
- Optional: Anthropic Messages API (`claude-sonnet-4-6`) for the natural-
  language summary, called only if `ANTHROPIC_API_KEY` is set. No other
  external API calls.

## What the current version can do
Validate structure/format, produce an explainable rule-based risk score,
route to one of three decisions, generate a summary (LLM or template),
and keep a redacted audit trail — synchronously, for one submission at a
time, with graceful degradation on every external dependency.

## What remains human-led
- The actual review of every `ESCALATED` case, and final approve/reject
  authority (the worker never rejects).
- Verifying that a `PENDING_INFO` vendor's resubmission is genuine and not
  an attempt to game the format checks.
- Deciding the risk-score thresholds/weights themselves — currently fixed
  constants a human set, not learned.
- Document *content* verification (the worker only checks whether documents
  were uploaded, never reads them).

## What I'd improve next version
- Replace the fixed-weight risk rules with a small, explainable model
  trained on real (anonymized) past decisions, keeping the rule-based
  version as a fallback/sanity check rather than removing it.
- Add a resubmission loop so `PENDING_INFO` cases automatically re-enter the
  workflow when the vendor updates their fields, instead of needing a fresh
  submission.
- Real OCR/document-content checks instead of a presence-only check.
- Persist state in a real datastore (MongoDB, matching the existing stack)
  instead of an append-only log file, so a reviewer can query "show me all
  ESCALATED submissions this week."

## Running it
```bash
npm install
npm run demo        # runs all sample submissions through the full workflow
npm start           # starts the HTTP API on :3000
curl -X POST localhost:3000/onboarding/submit -H "Content-Type: application/json" -d @data/sample_inputs.json
```
