import "dotenv/config";

import { getInput, setFailed, setOutput } from "@actions/core";

import l from "./lib/logger";
import { SolanaPayoutService } from "./lib/solana";

const logger = l.child({ scope: "driver" });

/**
 * Main function to execute the Solana Payout GitHub Action
 */
async function main(): Promise<void> {
  try {
    // Get sender wallet secret from environment variables
    const senderWalletSecret = process.env.SENDER_WALLET_SECRET;
    if (!senderWalletSecret) {
      logger.error(
        "Environment variable SENDER_WALLET_SECRET is not set, please set it in the repository secrets"
      );
      throw new Error(
        "Environment variable SENDER_WALLET_SECRET is not set, please set it in the repository secrets"
      );
    }

    // Get inputs from the GitHub Action
    const recipientWalletAddress = getInput("recipient-wallet-address", {
      required: true,
      trimWhitespace: true
    });
    const amount = parseFloat(
      getInput("amount", { required: true, trimWhitespace: true })
    );
    const token = getInput("token", { required: true, trimWhitespace: true });
    const network =
      getInput("network", { required: false, trimWhitespace: true }) ||
      "mainnet-beta"; // Default to mainnet-beta
    const timeout =
      parseInt(
        getInput("timeout", { required: false, trimWhitespace: true })
      ) || 300 * 1000; // Default to 5 minutes

    // Create, initialize, and execute the payment service
    const payoutService = new SolanaPayoutService(
      senderWalletSecret,
      recipientWalletAddress,
      amount,
      token,
      network,
      timeout
    );

    await payoutService.initialize();
    const signature = await payoutService.executePayment();

    // Set outputs for GitHub Actions
    setOutput("success", "true");
    setOutput("error", "");
    setOutput("transaction", signature);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("❌ Error occurred while executing the solana payout action");
    logger.error(error.message, { name: error.name, stack: error.stack });

    // Set outputs for GitHub Actions
    setOutput("success", "false");
    setOutput("error", error.message);
    setOutput("transaction", "");

    // Set the action as failed
    setFailed(error);
  }
}

// Run the main function
main();
