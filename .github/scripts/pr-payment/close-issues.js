#!/usr/bin/env node

const { execSync } = require("child_process");

/**
 * Script to close issues that were identified in CODEOWNER comments
 * but might not have been closed automatically by GitHub's PR description parsing
 *
 * Also adds payment information to the issue comments if a payment was made
 */

// Get environment variables
const issues = process.env.ISSUES || "none";
const prNumber = process.env.PR_NUMBER;
const repo = process.env.REPO;
const prAuthor = process.env.PR_AUTHOR || "a contributor";

// Payment-related environment variables
const payoutSuccess = process.env.PAYOUT_SUCCESS === "true";
const bountyAmount = process.env.BOUNTY_AMOUNT;
const bountyDetails = process.env.BOUNTY_DETAILS;
const network = process.env.SOLANA_NETWORK;
const recipientWallet = process.env.RECIPIENT_WALLET;
const transactionSignature = process.env.TRANSACTION_SIGNATURE;

// Exit early if no issues to process
if (issues === "none") {
  console.log("No issues to close.");
  process.exit(0);
}

// Process each issue
const issueNumbers = issues.split(",");
console.log(
  `Found ${
    issueNumbers.length
  } issues to check and close if needed: ${issueNumbers.join(", ")}`
);

// Track results for summary
const results = {
  alreadyClosed: [],
  successfullyClosed: [],
  failed: [],
};

for (const issueNumber of issueNumbers) {
  try {
    // First, check if the issue is already closed
    console.log(`Checking status of issue #${issueNumber}...`);
    let issueData;

    try {
      issueData = JSON.parse(
        execSync(`gh api repos/${repo}/issues/${issueNumber}`, {
          encoding: "utf8",
        })
      );
    } catch (apiError) {
      console.error(
        `Error fetching issue #${issueNumber}: ${apiError.message}`
      );
      console.log(
        `Issue might not exist or you may not have permission to access it.`
      );
      results.failed.push({
        number: issueNumber,
        reason: "API error when fetching issue",
      });
      continue;
    }

    if (issueData.state === "closed") {
      console.log(`Issue #${issueNumber} is already closed. Skipping.`);
      results.alreadyClosed.push(issueNumber);
      continue;
    }

    // If issue is open, close it with a reference to the PR
    console.log(`Closing issue #${issueNumber}...`);

    // Create a comment mentioning the PR that resolved this issue
    let commentBody;

    if (payoutSuccess && bountyAmount) {
      // Include payment information if a payment was made
      commentBody =
        `🎉 This issue was resolved by PR #${prNumber} from @${prAuthor} and has been paid a bounty!\n\n` +
        `**Payment Details:**\n` +
        `- Amount: ${bountyAmount} $MAIAR (${bountyDetails})\n` +
        `- Network: ${network}\n` +
        `- Recipient: \`${recipientWallet}\`\n`;

      // Add transaction links if available
      if (transactionSignature) {
        commentBody += `- Transaction: [View on Explorer](https://explorer.solana.com/tx/${transactionSignature}${
          network !== "mainnet-beta" ? `?cluster=${network}` : ""
        }) | [View on Solscan](https://solscan.io/tx/${transactionSignature}${
          network !== "mainnet-beta" ? `?cluster=${network}` : ""
        })\n\n`;
      }

      commentBody += `See the full PR here: https://github.com/${repo}/pull/${prNumber}`;
    } else {
      // Standard comment without payment info
      commentBody =
        `✅ This issue was resolved by PR #${prNumber} from @${prAuthor} and is being automatically closed.\n\n` +
        `See the full PR here: https://github.com/${repo}/pull/${prNumber}`;
    }

    try {
      execSync(
        `gh api repos/${repo}/issues/${issueNumber}/comments -X POST -f body='${commentBody}'`,
        { encoding: "utf8" }
      );
    } catch (commentError) {
      console.error(
        `Error adding comment to issue #${issueNumber}: ${commentError.message}`
      );
      // Continue trying to close the issue even if comment fails
    }

    // Close the issue
    try {
      execSync(
        `gh api repos/${repo}/issues/${issueNumber} -X PATCH -f state=closed`,
        { encoding: "utf8" }
      );
      console.log(
        `Successfully closed issue #${issueNumber} with reference to PR #${prNumber}`
      );
      results.successfullyClosed.push(issueNumber);
    } catch (closeError) {
      console.error(
        `Error closing issue #${issueNumber}: ${closeError.message}`
      );
      results.failed.push({
        number: issueNumber,
        reason: "Failed to close issue",
      });
    }
  } catch (error) {
    console.error(
      `Unexpected error processing issue #${issueNumber}:`,
      error.message
    );
    results.failed.push({ number: issueNumber, reason: "Unexpected error" });
    // Continue with other issues even if one fails
  }
}

// Print summary
console.log("\n--- Issue Closing Summary ---");
console.log(`Total issues processed: ${issueNumbers.length}`);
console.log(
  `Already closed: ${
    results.alreadyClosed.length
  } (${results.alreadyClosed.join(", ")})`
);
console.log(
  `Successfully closed: ${
    results.successfullyClosed.length
  } (${results.successfullyClosed.join(", ")})`
);
console.log(`Failed to process: ${results.failed.length}`);

if (results.failed.length > 0) {
  console.log("Failed issues:");
  results.failed.forEach((issue) => {
    console.log(`  - #${issue.number}: ${issue.reason}`);
  });
}

console.log("Issue closing process completed.");
