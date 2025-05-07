import { Octokit } from "@octokit/rest";
import fs from "fs";

const README_PATH = "README.md";
const PACKAGE_JSON_PATH = "package.json";

const owner = "UraniumCorporation";
const repo = "solana-payout-action";

(async () => {
  const octokit = new Octokit();
  const latestRelease = await octokit.rest.repos.getLatestRelease({
    owner,
    repo
  });
  const latestVersionTag = latestRelease.data.tag_name;

  // Get the current version from package.json (when running release-it, this will be the next version)
  const nextVersion = fs.readFileSync(PACKAGE_JSON_PATH, "utf-8");
  const nextVersionTag = JSON.parse(nextVersion).version;

  // Get the changelog
  const readme = fs.readFileSync(README_PATH, "utf-8");

  // Replace the all instances of the latest version tag with the next version tag
  const updatedReadme = readme.replace(
    new RegExp(latestVersionTag, "g"),
    `v${nextVersionTag}`
  );

  // Update the README examples using the next version tag
  fs.writeFileSync(README_PATH, updatedReadme, "utf-8");

  console.log(
    `✅ Updated ${README_PATH} examples using the next version tag ${nextVersionTag}`
  );
})();
