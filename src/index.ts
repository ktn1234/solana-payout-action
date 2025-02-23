import "dotenv/config";
import { getInput, setOutput, setFailed } from "@actions/core";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";

interface NetworkUrls {
  [key: string]: string;
}

const NETWORK_URLS: NetworkUrls = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

// Solana's minimum transaction fee (5000 lamports per signature)
// We add a conservative buffer (0.1 SOL) to ensure transaction success
// This covers potential fee increases due to:
// - Network congestion
// - Number of instructions in the transaction
// - Additional signatures if required
// - Compute units consumed
const TRANSACTION_FEE_BUFFER = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL buffer for fees

async function validateWalletAddress(
  connection: Connection,
  address: string,
  type: string = "wallet",
  network: string = "unknown"
): Promise<PublicKey> {
  try {
    const pubKey = new PublicKey(address);

    // Check if address is valid Solana public key format
    if (!PublicKey.isOnCurve(pubKey)) {
      throw new Error(`Invalid ${type} wallet address format: ${address}`);
    }

    // For basic SOL accounts, we should check balance instead of account info
    const balance = await connection.getBalance(pubKey);
    console.log(`${type} wallet balance:`, balance / LAMPORTS_PER_SOL, "SOL");

    // We don't throw if balance is 0, just log it
    if (balance === 0) {
      console.log(
        `Warning: ${type} wallet has 0 balance on ${network} network`
      );
    }

    return pubKey;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Invalid public key input")
    ) {
      throw new Error(`Invalid ${type} wallet address format: ${address}`);
    }
    throw error;
  }
}

async function validateSenderBalance(
  connection: Connection,
  senderPubKey: PublicKey,
  requiredAmount: number,
  network: string
): Promise<number> {
  try {
    const balance = await connection.getBalance(senderPubKey);

    // Calculate total required with a conservative fee buffer
    const totalRequired = requiredAmount + TRANSACTION_FEE_BUFFER;

    if (balance < totalRequired) {
      const solBalance = balance / LAMPORTS_PER_SOL;
      const solRequired = totalRequired / LAMPORTS_PER_SOL;
      const feeBuffer = TRANSACTION_FEE_BUFFER / LAMPORTS_PER_SOL;

      throw new Error(
        `Insufficient funds in sender wallet on ${network} network. ` +
          `Balance: ${solBalance} SOL, ` +
          `Required: ${solRequired} SOL ` +
          `(including ${feeBuffer} SOL buffer for transaction fees)`
      );
    }

    return balance;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Insufficient funds")
    ) {
      throw error;
    }
    throw new Error(
      `Failed to check sender wallet balance: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function main(): Promise<void> {
  try {
    console.log("Starting Solana payment process...");

    // Get sender wallet secret from environment variables
    const SENDER_WALLET_SECRET = process.env.SENDER_WALLET_SECRET;
    if (!SENDER_WALLET_SECRET) {
      setOutput("success", "false");
      throw new Error(
        "Environment variable SENDER_WALLET_SECRET is not set, please set it in the repository secrets"
      );
    }
    console.log("✓ Sender wallet secret loaded");

    // Get inputs from the GitHub Action
    const recipientWalletAddress = getInput("recipient-wallet-address", {
      required: true,
    });
    const amount = parseFloat(getInput("amount", { required: true }));
    const network = getInput("network", { required: false }) || "mainnet-beta";

    console.log(`Network: ${network}`);
    console.log(`Amount to send: ${amount} SOL`);

    // Validate inputs and connect
    if (isNaN(amount) || amount <= 0) {
      throw new Error("SOL Amount must be a positive number");
    }

    if (!NETWORK_URLS[network]) {
      throw new Error(
        `Invalid network specified. Must be one of: ${Object.keys(
          NETWORK_URLS
        ).join(", ")}`
      );
    }

    // Connect to Solana network
    console.log(`Connecting to Solana ${network}...`);
    const connection = new Connection(NETWORK_URLS[network]);
    console.log("✓ Connected to network");

    // Create and validate sender keypair
    console.log("Validating sender wallet...");
    const senderKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(SENDER_WALLET_SECRET))
    );
    await validateWalletAddress(
      connection,
      senderKeypair.publicKey.toString(),
      "sender",
      network
    );
    console.log("✓ Sender wallet validated");

    // Check sender balance
    console.log("Checking sender balance...");
    const requiredAmount = amount * LAMPORTS_PER_SOL;
    await validateSenderBalance(
      connection,
      senderKeypair.publicKey,
      requiredAmount,
      network
    );
    console.log("✓ Sufficient balance confirmed");

    // Validate recipient address
    console.log("Validating recipient wallet...");
    const recipientPubKey = await validateWalletAddress(
      connection,
      recipientWalletAddress,
      "recipient",
      network
    );
    console.log("✓ Recipient wallet validated");

    // Create and send transaction
    console.log("Creating transaction...");
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderKeypair.publicKey,
        toPubkey: recipientPubKey,
        lamports: amount * LAMPORTS_PER_SOL,
      })
    );

    console.log("Sending transaction...");
    const signature = await connection.sendTransaction(transaction, [
      senderKeypair,
    ]);
    console.log("Transaction sent:", signature);

    // Wait for confirmation
    console.log("Waiting for confirmation...");
    const confirmation = await connection.confirmTransaction(signature);

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err}`);
    }
    console.log("✓ Transaction confirmed");

    // Add network info to success message
    console.log("🎉 Transaction complete!");
    console.log(
      `Successfully sent ${amount} SOL to ${recipientWalletAddress} on ${network}`
    );
    console.log(`Transaction signature: ${signature}`);

    // Set success output
    setOutput("success", "true");
  } catch (error) {
    // Set error output and success as false
    setOutput("success", "false");
    setOutput("error", error instanceof Error ? error.message : String(error));

    console.error(
      "❌ Error:",
      error instanceof Error ? error.message : String(error)
    );
    setFailed(error instanceof Error ? error.message : String(error));
  }
}

main();
