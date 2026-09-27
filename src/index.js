const express = require("express");
const { processSubmission } = require("./worker");

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/onboarding/submit", async (req, res) => {
  try {
    const result = await processSubmission(req.body);
    res.status(200).json(result);
  } catch (err) {
    // Defensive net: even an unexpected internal error becomes a safe,
    // escalated response rather than a raw 500 with a stack trace.
    res.status(200).json({
      decision: "ESCALATED",
      escalationReason: "internal processing error — needs manual review",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Onboarding worker listening on :${PORT}`));
}

module.exports = app;
