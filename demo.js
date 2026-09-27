const fs = require("fs");
const path = require("path");
const { processSubmission } = require("./src/worker");

const samples = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "sample_inputs.json"), "utf8"));

async function main() {
  const results = [];
  for (const [i, submission] of samples.entries()) {
    console.log("\n=================================================");
    console.log(`Submission ${i + 1}: ${submission ? submission.id : "(null / unreadable payload)"}`);
    console.log("=================================================");
    const result = await processSubmission(submission);
    console.log("States:      ", result.states.join(" -> "));
    console.log("Decision:    ", result.decision);
    console.log("Risk:        ", `${result.risk.score}/100 (${result.risk.band})`);
    if (result.validation.missing.length) console.log("Missing:     ", result.validation.missing.join(", "));
    if (result.validation.malformed.length)
      console.log("Malformed:   ", result.validation.malformed.map((m) => `${m.field} (${m.reason})`).join("; "));
    console.log("Summary src: ", result.summarySource, result.summaryFailureReason ? `— ${result.summaryFailureReason}` : "");
    console.log("Summary:     ", result.summary);
    if (result.escalationReason) console.log("Escalation:  ", result.escalationReason);
    results.push({ input: submission, result });
  }

  fs.writeFileSync(
    path.join(__dirname, "demo_output.json"),
    JSON.stringify(results, null, 2)
  );
  console.log("\nFull structured output written to demo_output.json");
  console.log("Redacted audit log written to logs/audit.log");
}

main();
