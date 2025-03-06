const { spawnSync } = require("child_process");

// Get inputs from environment variables
const success = process.env.PAYOUT_SUCCESS;
const error = process.env.PAYOUT_ERROR;
const transaction = process.env.TRANSACTION_SIGNATURE;
const prNumber = process.env.PR_NUMBER;
const prAuthor = process.env.PR_AUTHOR;
const issues = process.env.ISSUES;
const bountyAmount = process.env.BOUNTY_AMOUNT;
const bountyDetails = process.env.BOUNTY_DETAILS;
const network = process.env.SOLANA_NETWORK;
const recipientWallet = process.env.RECIPIENT_WALLET || "";

// Log the wallet address to help with debugging
console.log(`Processing payment for wallet: ${recipientWallet}`);

if (success === "true") {
  console.log("✅ Successfully paid contributor!");
  console.log(`Transaction completed on ${network}`);
  console.log(`Transaction signature: ${transaction}`);

  // Prepare issues text for the comment
  let issuesList = "";
  if (issues !== "none") {
    // Convert comma-separated list to "#X, #Y" format with links
    issuesList = issues
      .split(",")
      .map(
        (issue) =>
          `[#${issue}](https://github.com/${process.env.GITHUB_REPOSITORY}/issues/${issue})`
      )
      .join(", ");

    // Add a comment to the PR with issues
    const successComment =
      "🎉 Payment Successful!\n\n" +
      `Thank you @${prAuthor} for your contribution in resolving ${issuesList}!\n\n` +
      `- Amount: ${bountyAmount} $MAIAR (${bountyDetails})\n` +
      `- Network: ${network}\n` +
      `- Recipient: ${recipientWallet}\n` +
      `- Transaction: [View on Explorer](https://explorer.solana.com/tx/${transaction}${
        network !== "mainnet-beta" ? `?cluster=${network}` : ""
      }) | [View on Solscan](https://solscan.io/tx/${transaction}${
        network !== "mainnet-beta" ? `?cluster=${network}` : ""
      })`;

    // Use spawnSync to avoid shell interpretation issues
    spawnSync("gh", ["pr", "comment", prNumber, "--body", successComment], {
      stdio: "inherit",
    });
  } else {
    // Add a comment to the PR without issues
    const successComment =
      "🎉 Payment Successful!\n\n" +
      `Thank you @${prAuthor} for your contribution!\n\n` +
      `- Amount: ${bountyAmount} $MAIAR (${bountyDetails})\n` +
      `- Network: ${network}\n` +
      `- Recipient: ${recipientWallet}\n` +
      `- Transaction: [View on Explorer](https://explorer.solana.com/tx/${transaction}${
        network !== "mainnet-beta" ? `?cluster=${network}` : ""
      }) | [View on Solscan](https://solscan.io/tx/${transaction}${
        network !== "mainnet-beta" ? `?cluster=${network}` : ""
      })`;

    // Use spawnSync to avoid shell interpretation issues
    spawnSync("gh", ["pr", "comment", prNumber, "--body", successComment], {
      stdio: "inherit",
    });
  }
} else {
  console.log("❌ Payment failed:");
  console.log(error);

  // Add a comment about the failure
  const failureComment =
    "❌ Payment Failed\n\n" +
    "There was an error processing the payment:\n" +
    "```\n" +
    `${error}\n` +
    "```\n\n" +
    "Please contact the repository administrators for assistance.";

  // Use spawnSync to avoid shell interpretation issues
  spawnSync("gh", ["pr", "comment", prNumber, "--body", failureComment], {
    stdio: "inherit",
  });
  process.exit(1);
}
