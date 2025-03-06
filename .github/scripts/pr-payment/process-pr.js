const { execSync } = require("child_process");

// Get inputs from environment variables
const prNumber = process.env.PR_NUMBER;
const prAuthor = process.env.PR_AUTHOR;
const issues = process.env.ISSUES;

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
  const comment =
    "✅ PR Merged\n\n" +
    `Thank you @${prAuthor} for your contribution in resolving ${issuesList}!`;

  execSync(`gh pr comment "${prNumber}" --body "${comment}"`, {
    encoding: "utf8",
  });
} else {
  // Add a comment to the PR without issues
  const comment =
    "✅ PR Merged\n\n" + `Thank you @${prAuthor} for your contribution!`;

  execSync(`gh pr comment "${prNumber}" --body "${comment}"`, {
    encoding: "utf8",
  });
}
