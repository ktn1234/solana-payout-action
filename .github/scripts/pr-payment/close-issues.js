const { execSync, spawnSync } = require("child_process");

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
const recipientWallet = process.env.RECIPIENT_WALLET || "";
const transactionSignature = process.env.TRANSACTION_SIGNATURE;

// Determine if a payment was made
const paymentWasMade =
  payoutSuccess && bountyAmount && parseFloat(bountyAmount) > 0;

// Log payment status
console.log(
  `Payment status: ${
    paymentWasMade ? "Payment was made" : "No payment was made"
  }`
);
if (paymentWasMade) {
  console.log(`Payment amount: ${bountyAmount} $MAIAR`);
  console.log(
    `Transaction signature: ${transactionSignature || "Not available"}`
  );
}

/**
 * Creates a comment body for an issue based on whether a payment was made
 * @param {boolean} wasPaid - Whether a payment was made for this issue
 * @returns {string} The formatted comment body
 */
function createCommentBody(wasPaid) {
  if (wasPaid) {
    // Include payment information if a payment was made
    let comment =
      `🎉 This issue was resolved by PR #${prNumber} from @${prAuthor} and has been paid a bounty!\n\n` +
      `**Payment Details:**\n` +
      `- Amount: ${bountyAmount} $MAIAR (${bountyDetails})\n` +
      `- Network: ${network}\n` +
      `- Recipient: ${recipientWallet}\n`;

    // Add transaction links if available
    if (transactionSignature) {
      comment += `- Transaction: [View on Explorer](https://explorer.solana.com/tx/${transactionSignature}${
        network !== "mainnet-beta" ? `?cluster=${network}` : ""
      }) | [View on Solscan](https://solscan.io/tx/${transactionSignature}${
        network !== "mainnet-beta" ? `?cluster=${network}` : ""
      })\n\n`;
    }

    comment += `See the full PR here: https://github.com/${repo}/pull/${prNumber}`;
    return comment;
  } else {
    // Standard comment without payment info
    return (
      `✅ This issue was resolved by PR #${prNumber} from @${prAuthor}.\n\n` +
      `See the full PR here: https://github.com/${repo}/pull/${prNumber}`
    );
  }
}

// Exit early if no issues to process
if (issues === "none") {
  console.log("No issues to close.");
  process.exit(0);
}

// Process each issue
const issueNumbers = issues.split(",");
console.log(
  `Found ${issueNumbers.length} issue${
    issueNumbers.length !== 1 ? "s" : ""
  } to close from PR #${prNumber}:`
);

// Log each issue with its link
issueNumbers.forEach((issueNumber) => {
  console.log(
    `- Issue #${issueNumber} (https://github.com/${repo}/issues/${issueNumber})`
  );
});

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
      console.log(
        `Issue #${issueNumber} is already closed. Adding comment anyway.`
      );

      // Create a comment mentioning the PR that resolved this issue, even though it's already closed
      let commentBody = createCommentBody(paymentWasMade);

      try {
        // Use spawnSync to avoid shell interpretation issues with special characters
        spawnSync(
          "gh",
          [
            "api",
            `repos/${repo}/issues/${issueNumber}/comments`,
            "-X",
            "POST",
            "-f",
            `body=${commentBody}`,
          ],
          {
            stdio: "inherit",
          }
        );
        console.log(`Added comment to already closed issue #${issueNumber}`);
      } catch (commentError) {
        console.error(
          `Error adding comment to issue #${issueNumber}: ${commentError.message}`
        );
      }

      results.alreadyClosed.push(issueNumber);
      continue;
    }

    // If issue is open, close it with a reference to the PR
    console.log(`Closing issue #${issueNumber}...`);

    // Create a comment mentioning the PR that resolved this issue
    let commentBody = createCommentBody(paymentWasMade);

    try {
      // Use spawnSync to avoid shell interpretation issues with special characters
      spawnSync(
        "gh",
        [
          "api",
          `repos/${repo}/issues/${issueNumber}/comments`,
          "-X",
          "POST",
          "-f",
          `body=${commentBody}`,
        ],
        {
          stdio: "inherit",
        }
      );
    } catch (commentError) {
      console.error(
        `Error adding comment to issue #${issueNumber}: ${commentError.message}`
      );
      // Continue trying to close the issue even if comment fails
    }

    // Close the issue
    try {
      // Use spawnSync to avoid shell interpretation issues
      spawnSync(
        "gh",
        [
          "api",
          `repos/${repo}/issues/${issueNumber}`,
          "-X",
          "PATCH",
          "-f",
          "state=closed",
        ],
        {
          stdio: "inherit",
        }
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
console.log("\n--- Issue Closing Summary for PR #" + prNumber + " ---");
console.log(`Total issues processed: ${issueNumbers.length}`);

if (results.alreadyClosed.length > 0) {
  console.log(`Already closed (${results.alreadyClosed.length}):`);
  results.alreadyClosed.forEach((issueNumber) => {
    console.log(
      `  - Issue #${issueNumber} (https://github.com/${repo}/issues/${issueNumber})`
    );
  });
}

if (results.successfullyClosed.length > 0) {
  console.log(`Successfully closed (${results.successfullyClosed.length}):`);
  results.successfullyClosed.forEach((issueNumber) => {
    console.log(
      `  - Issue #${issueNumber} (https://github.com/${repo}/issues/${issueNumber})`
    );
  });
}

if (results.failed.length > 0) {
  console.log(`Failed to process (${results.failed.length}):`);
  results.failed.forEach((issue) => {
    console.log(
      `  - Issue #${issue.number}: ${issue.reason} (https://github.com/${repo}/issues/${issue.number})`
    );
  });
}

console.log("Issue closing process completed.");
