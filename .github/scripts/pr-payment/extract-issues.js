const { execSync } = require("child_process");
const fs = require("fs");

// Get PR information from environment variables
const prNumber = process.env.PR_NUMBER;
const repo = process.env.REPO;

// Get all comments on the PR
const commentsCmd = `gh api repos/${repo}/issues/${prNumber}/comments --paginate`;
const commentsOutput = execSync(commentsCmd, { encoding: "utf8" });
const comments = JSON.parse(commentsOutput);

// Get the list of CODEOWNERS from the CODEOWNERS file
let codeowners = [];
try {
  const codeownersFile = fs.readFileSync(".github/CODEOWNERS", "utf8");
  // Parse CODEOWNERS file with simple format: @user1 @user2
  codeowners = codeownersFile
    .trim()
    .split(/\s+/)
    .map((username) => username.replace("@", ""))
    .filter(Boolean);
} catch (error) {
  console.log(`Error reading CODEOWNERS file: ${error.message}`);
}

console.log(`CODEOWNERS: ${codeowners.join(" ")}`);

// Initialize an array for issue numbers
const issueNumbers = [];

// Loop through each comment to find those from CODEOWNERS that mention closing issues
for (const comment of comments) {
  const author = comment.user.login;
  const body = comment.body;

  // Check if the author is a CODEOWNER
  if (codeowners.includes(author)) {
    // Look for closing keywords followed by issue numbers
    const closingKeywordsRegex = /(?:closes|fixes|resolves)\s+#(\d+)/gi;
    let match;

    while ((match = closingKeywordsRegex.exec(body)) !== null) {
      const issueNumber = match[1];
      console.log(
        `Found issue #${issueNumber} mentioned by CODEOWNER ${author}`
      );
      if (!issueNumbers.includes(issueNumber)) {
        issueNumbers.push(issueNumber);
      }
    }
  }
}

// Convert array to comma-separated string
const issuesCsv = issueNumbers.length > 0 ? issueNumbers.join(",") : "none";

if (issuesCsv === "none") {
  console.log(
    "⚠️ No issues found that this PR closes (based on CODEOWNER comments)"
  );
} else {
  console.log(
    `Found ${issueNumbers.length} issue${
      issueNumbers.length !== 1 ? "s" : ""
    } that PR #${prNumber} closes (from CODEOWNER comments):`
  );
  issueNumbers.forEach((issueNumber) => {
    console.log(
      `- Issue #${issueNumber} (https://github.com/${repo}/issues/${issueNumber})`
    );
  });
}

// Set output for GitHub Actions
fs.appendFileSync(process.env.GITHUB_OUTPUT, `issues=${issuesCsv}\n`);
