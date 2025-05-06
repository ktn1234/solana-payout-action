import "dotenv/config";

import { spawnSync } from "child_process";

// GitHub Actions sets inputs as environment variables with this prefix
const amount = ""; // Small amount for testing
const network = ""; // Use devnet for testing
const token = ""; // SOL/SPL Token Address
const recipientAddress = ""; // Recipient Wallet Address
const timeout = ""; // Timeout to confirm the transaction in milliseconds

// Format matches GitHub Actions environment variable format
process.env["INPUT_RECIPIENT-WALLET-ADDRESS"] = recipientAddress;
process.env["INPUT_AMOUNT"] = amount;
process.env["INPUT_TOKEN"] = token;
process.env["INPUT_NETWORK"] = network;
process.env["INPUT_TIMEOUT"] = timeout;

// This simulates @actions/core's getInput
process.env["GITHUB_ACTION"] = "true";

spawnSync("node", ["dist/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env
  }
});
