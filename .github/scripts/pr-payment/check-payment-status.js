const { spawnSync } = require("child_process");
const fs = require("fs");

/**
 * Script to check if a payment has already been made for the issues
 * This prevents duplicate payments if the workflow is run multiple times
 */

// Get environment variables
const issues = process.env.ISSUES || "none";
const repo = process.env.REPO || process.env.GITHUB_REPOSITORY;

// Skip if no issues
if (issues === "none") {
  console.log("No issues to check for payment status.");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "already_paid=false\n");
  process.exit(0);
}

// Track if any issue has already been paid
let alreadyPaid = false;
const issueNumbers = issues.split(",");

console.log(`Checking payment status for ${issueNumbers.length} issues...`);

// Check each issue for payment comments
for (const issueNumber of issueNumbers) {
  try {
    console.log(`Checking issue #${issueNumber} for payment comments...`);

    // Get comments for the issue
    const result = spawnSync(
      "gh",
      [
        "api",
        `repos/${repo}/issues/${issueNumber}/comments`,
        "--jq",
        ".[].body",
      ],
      {
        encoding: "utf8",
        stdio: ["inherit", "pipe", "inherit"],
      }
    );

    if (result.status !== 0) {
      console.log(`Error fetching comments for issue #${issueNumber}`);
      continue;
    }

    const comments = result.stdout;

    // Check if any comment contains payment information
    if (
      comments.includes("🎉 This issue was resolved by PR") &&
      comments.includes("and has been paid a bounty")
    ) {
      console.log(`⚠️ Issue #${issueNumber} has already been paid!`);
      alreadyPaid = true;

      // Extract the payment details for logging
      const paymentMatch = comments.match(/Amount: ([0-9.]+) \$MAIAR/);
      const prMatch = comments.match(/PR #(\d+)/);

      if (paymentMatch && prMatch) {
        console.log(
          `  - Previously paid ${paymentMatch[1]} $MAIAR via PR #${prMatch[1]}`
        );
      }
    } else {
      console.log(`✅ No payment found for issue #${issueNumber}`);
    }
  } catch (error) {
    console.error(`Error checking issue #${issueNumber}: ${error.message}`);
  }
}

// Set output for GitHub Actions
fs.appendFileSync(process.env.GITHUB_OUTPUT, `already_paid=${alreadyPaid}\n`);

if (alreadyPaid) {
  console.log(
    "⚠️ At least one issue has already been paid. Payment will be skipped."
  );
} else {
  console.log(
    "✅ No previous payments found for these issues. Proceeding with payment."
  );
}
