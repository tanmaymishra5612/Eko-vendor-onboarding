/**
 * summarizer.js
 * Turns the structured decision (validation + risk) into a short, readable
 * note for the ops reviewer. Tries an LLM call for a natural-sounding note;
 * if the API is unreachable, the key is missing, or the response is
 * malformed/empty, it falls back to a deterministic template.
 *
 * This is the intentionally fragile part of the system, and deliberately so:
 * an onboarding decision must never silently disappear because a summary
 * sentence failed to generate. The DECISION always ships; only the prose
 * around it degrades.
 */

const MODEL = "claude-sonnet-4-6";

function templateSummary(submission, result) {
  const { validation, risk, decision } = result;
  const parts = [`Submission from "${submission.businessName || "unknown business"}".`];

  if (validation.missing.length > 0) {
    parts.push(`Missing: ${validation.missing.join(", ")}.`);
  }
  if (validation.malformed.length > 0) {
    parts.push(`Format issues: ${validation.malformed.map((m) => m.field).join(", ")}.`);
  }
  parts.push(`Risk score ${risk.score}/100 (${risk.band}).`);
  if (risk.reasons.length > 0) parts.push(`Reasons: ${risk.reasons.join("; ")}.`);
  parts.push(`Decision: ${decision}.`);

  return parts.join(" ");
}

async function generateSummary(submission, result) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { text: templateSummary(submission, result), source: "template", reason: "no API key configured" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `Write one short, plain-English sentence (max 30 words) summarizing this vendor onboarding review for an ops reviewer. Business: ${submission.businessName}. Missing fields: ${validation_list(result)}. Risk band: ${result.risk.band} (score ${result.risk.score}). Decision: ${result.decision}. No preamble, just the sentence.`,
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    if (!text) {
      throw new Error("empty or unclear model response");
    }

    return { text, source: "llm", reason: null };
  } catch (err) {
    // Any failure here — network down, timeout, bad key, malformed response —
    // degrades to the template. The caller never sees an exception.
    return {
      text: templateSummary(submission, result),
      source: "template",
      reason: `LLM summary failed: ${err.message}`,
    };
  }
}

function validation_list(result) {
  return result.validation.missing.length ? result.validation.missing.join(", ") : "none";
}

module.exports = { generateSummary, templateSummary };
