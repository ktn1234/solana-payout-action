const { execSync } = require("child_process");
const fs = require("fs");

// Get PR information from environment variables
const prNumber = process.env.PR_NUMBER;
const prAuthor = process.env.PR_AUTHOR;
const repo = process.env.REPO;

console.log(`Looking for wallet address in comments by PR author: ${prAuthor}`);

// Get all comments on the PR
const commentsCmd = `gh api repos/${repo}/issues/${prNumber}/comments --paginate`;
const commentsOutput = execSync(commentsCmd, { encoding: "utf8" });
const comments = JSON.parse(commentsOutput);

// Process all comments to find the most recent wallet address
let wallet = undefined;

for (const comment of comments) {
  const author = comment.user.login;
  const body = comment.body;

  // Check if the comment is from the PR author
  if (author === prAuthor) {
    // Look for Solana wallet address using regex
    const walletMatch = body.match(/solana:([A-Za-z0-9]{32,})/);
    if (walletMatch && walletMatch[1]) {
      const foundWallet = walletMatch[1];
      console.log(
        `Found wallet address in comment by PR author: ${foundWallet}`
      );
      // Keep updating the wallet variable to use the most recent one
      wallet = foundWallet;
    }
  }
}

if (!wallet) {
  console.log(
    "❌ No valid Solana wallet address found in PR author's comments"
  );
  console.log(
    "PR author must include a wallet address in a comment with the format:"
  );
  console.log("solana:<insert-wallet-address-here>");
  process.exit(1);
}

console.log(`Using most recent wallet address: ${wallet}`);

// Set output for GitHub Actions
fs.appendFileSync(process.env.GITHUB_OUTPUT, `wallet=${wallet}\n`);
