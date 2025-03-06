const { execSync } = require("child_process");
const fs = require("fs");

// Get inputs from environment variables
const repo = process.env.REPO;
const issues = process.env.ISSUES;

if (issues === "none") {
  console.log("No issues found, skipping payment");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "total_bounty=0\n");
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    "bounty_details=No issues found\n"
  );
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "should_pay=false\n");
  process.exit(0);
}

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

// Initialize variables for bounty calculation
let totalBounty = 0;
let bountyDetails = [];
let foundBounty = false;

// Process each issue
const issueArray = issues.split(",");

for (const issueNumber of issueArray) {
  console.log(`Processing issue #${issueNumber}`);

  try {
    // Get issue details
    const issueDataCmd = `gh api repos/${repo}/issues/${issueNumber}`;
    const issueDataOutput = execSync(issueDataCmd, { encoding: "utf8" });
    const issueData = JSON.parse(issueDataOutput);

    // Check if issue has bounty label
    const hasBountyLabel =
      issueData.labels &&
      issueData.labels.some((label) => label.name === "bounty");

    if (hasBountyLabel) {
      console.log(`Issue #${issueNumber} has bounty label`);

      // Get all comments on the issue
      const issueCommentsCmd = `gh api repos/${repo}/issues/${issueNumber}/comments --paginate`;
      const issueCommentsOutput = execSync(issueCommentsCmd, {
        encoding: "utf8",
      });
      const issueComments = JSON.parse(issueCommentsOutput);

      // Find bounty amount in CODEOWNER comments
      let bountyAmount = null;

      for (const comment of issueComments) {
        const author = comment.user.login;
        const body = comment.body;

        // Check if the author is a CODEOWNER
        if (codeowners.includes(author)) {
          // Look for bounty specification
          const bountyMatch = body.match(
            /[Bb][Oo][Uu][Nn][Tt][Yy]:\s*(\d+(?:\.\d+)?)\s*\$MAIAR/
          );
          if (bountyMatch && bountyMatch[1]) {
            const amount = parseFloat(bountyMatch[1]);
            console.log(
              `Found bounty amount: ${amount} for issue #${issueNumber}`
            );
            bountyAmount = amount;
            foundBounty = true;
            break;
          }
        }
      }

      if (bountyAmount !== null) {
        console.log(`Adding ${bountyAmount} to total bounty`);
        totalBounty += bountyAmount;
        bountyDetails.push(`Issue #${issueNumber}: ${bountyAmount}`);
      } else {
        console.log(`No bounty amount found for issue #${issueNumber}`);
      }
    } else {
      console.log(`Issue #${issueNumber} does not have bounty label`);
    }
  } catch (error) {
    console.log(`Error processing issue #${issueNumber}: ${error.message}`);
  }
}

// Join bounty details with commas
const bountyDetailsStr = bountyDetails.join(", ");

// If no bounty was found, skip payment
if (!foundBounty || totalBounty === 0) {
  console.log("No bounty amounts found, skipping payment");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "should_pay=false\n");
} else {
  console.log(`Total bounty amount: ${totalBounty}`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "should_pay=true\n");
}

fs.appendFileSync(process.env.GITHUB_OUTPUT, `total_bounty=${totalBounty}\n`);
fs.appendFileSync(
  process.env.GITHUB_OUTPUT,
  `bounty_details=${bountyDetailsStr}\n`
);
