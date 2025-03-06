import "dotenv/config";
import { getInput, setOutput, setFailed } from "@actions/core";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  SystemProgram,
  AccountInfo,
  ParsedAccountData,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  getMint,
} from "@solana/spl-token";

interface NetworkUrls {
  [key: string]: string;
}

const NETWORK_URLS: NetworkUrls = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

// Solana's minimum transaction fee (5000 lamports per signature)
// We add a conservative buffer to ensure transaction success
// This covers potential fee increases due to:
// - Network congestion
// - Number of instructions in the transaction
// - Additional signatures if required
// - Compute units consumed
const TRANSACTION_FEE_BUFFER = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL buffer for fees

// Cost to create a token account (rent exemption + transaction fee)
// This is approximately 0.00203928 SOL as of early 2023
const TOKEN_ACCOUNT_CREATION_COST = 0.003 * LAMPORTS_PER_SOL; // 0.003 SOL for token account creation

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
    const solBalance = balance / LAMPORTS_PER_SOL;
    console.log(
      `${type} wallet balance: ${solBalance.toLocaleString()} SOL (${balance.toString()} lamports)`
    );

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
  network: string,
  mayNeedTokenAccount: boolean = false
): Promise<number> {
  try {
    const balance = await connection.getBalance(senderPubKey);

    // Calculate total required with a conservative fee buffer
    let totalRequired = requiredAmount + TRANSACTION_FEE_BUFFER;

    // Add token account creation cost if needed
    if (mayNeedTokenAccount) {
      totalRequired += TOKEN_ACCOUNT_CREATION_COST;
      console.log(
        `Including potential token account creation cost: ${
          TOKEN_ACCOUNT_CREATION_COST / LAMPORTS_PER_SOL
        } SOL`
      );
    }

    // Format for human-readable display
    const solBalance = balance / LAMPORTS_PER_SOL;
    const solRequired = requiredAmount / LAMPORTS_PER_SOL;
    const feeBuffer = TRANSACTION_FEE_BUFFER / LAMPORTS_PER_SOL;
    const solTotalRequired = totalRequired / LAMPORTS_PER_SOL;

    console.log(
      `Current SOL balance: ${solBalance.toLocaleString()} SOL (${balance.toString()} lamports)`
    );

    if (requiredAmount > 0) {
      console.log(
        `Required amount: ${solRequired.toLocaleString()} SOL (${requiredAmount.toString()} lamports)`
      );
    }

    console.log(
      `Fee buffer: ${feeBuffer.toLocaleString()} SOL (${TRANSACTION_FEE_BUFFER.toString()} lamports)`
    );
    console.log(
      `Total required: ${solTotalRequired.toLocaleString()} SOL (${totalRequired.toString()} lamports)`
    );

    if (balance < totalRequired) {
      throw new Error(
        `Insufficient funds in sender wallet on ${network} network. ` +
          `Balance: ${solBalance.toLocaleString()} SOL, ` +
          `Required: ${solTotalRequired.toLocaleString()} SOL ` +
          `(including ${feeBuffer.toLocaleString()} SOL buffer for transaction fees${
            mayNeedTokenAccount ? ` and potential token account creation` : ""
          })`
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

async function validateSenderTokenBalance(
  connection: Connection,
  senderPubKey: PublicKey,
  tokenMint: PublicKey,
  requiredAmount: number,
  network: string
): Promise<bigint> {
  try {
    // Get the associated token account for the sender
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      Keypair.generate(), // Dummy keypair for read-only operation
      tokenMint,
      senderPubKey,
      false // Don't create if it doesn't exist
    );

    if (!tokenAccount) {
      throw new Error(
        `No token account found for token ${tokenMint.toString()} in sender wallet on ${network} network`
      );
    }

    // Get the token account info
    const accountInfo = await getAccount(connection, tokenAccount.address);
    const balance = accountInfo.amount;

    // Get token mint info to determine decimals
    const mintInfo = await getMint(connection, tokenMint);
    const decimals = mintInfo.decimals;
    console.log(`Token decimals: ${decimals}`);

    // Convert required amount to token amount considering decimals
    const requiredTokenAmount = BigInt(
      Math.floor(requiredAmount * 10 ** decimals)
    );

    // Format balances for human-readable display
    const balanceFormatted = Number(balance) / 10 ** decimals;
    const requiredFormatted = requiredAmount;

    console.log(
      `Required amount: ${requiredFormatted} tokens (${requiredTokenAmount.toString()} raw)`
    );
    console.log(
      `Current balance: ${balanceFormatted} tokens (${balance.toString()} raw)`
    );

    if (balance < requiredTokenAmount) {
      throw new Error(
        `Insufficient token balance in sender wallet on ${network} network. ` +
          `Balance: ${balanceFormatted} tokens, ` +
          `Required: ${requiredFormatted} tokens`
      );
    }

    return balance;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Insufficient token balance") ||
        error.message.includes("No token account found"))
    ) {
      throw error;
    }
    throw new Error(
      `Failed to check sender token balance: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function validateTokenAddress(
  connection: Connection,
  tokenAddress: string,
  network: string = "unknown"
): Promise<{ mint: PublicKey; supply: bigint; decimals: number }> {
  try {
    console.log(
      `Validating token address ${tokenAddress} on ${network} network...`
    );

    // Check if address is a valid Solana public key
    const tokenMint = new PublicKey(tokenAddress);
    if (!PublicKey.isOnCurve(tokenMint)) {
      throw new Error(`Invalid token address format: ${tokenAddress}`);
    }

    // Get token mint info to verify it's a valid SPL token
    try {
      const mintInfo = await getMint(connection, tokenMint);

      console.log(`✓ Valid SPL token found`);

      // Calculate human-readable supply
      const decimals = mintInfo.decimals;
      const rawSupply = mintInfo.supply;
      const humanReadableSupply = Number(rawSupply) / Math.pow(10, decimals);

      console.log(`Token decimals: ${decimals}`);
      console.log(
        `Token supply: ${humanReadableSupply.toLocaleString()} tokens (${rawSupply.toString()} raw)`
      );

      if (mintInfo.mintAuthority) {
        console.log(`Mint authority: ${mintInfo.mintAuthority.toString()}`);
      } else {
        console.log(`Mint authority: None (fixed supply)`);
      }

      if (mintInfo.freezeAuthority) {
        console.log(`Freeze authority: ${mintInfo.freezeAuthority.toString()}`);
      } else {
        console.log(`Freeze authority: None (non-freezable)`);
      }

      return {
        mint: tokenMint,
        supply: mintInfo.supply,
        decimals: mintInfo.decimals,
      };
    } catch (error) {
      throw new Error(
        `Invalid SPL token: ${tokenAddress}. Error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid SPL token")) {
      throw error;
    }
    throw new Error(
      `Failed to validate token address: ${
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
    const token = getInput("token", { required: true });

    console.log(`Network: ${network}`);

    // Determine if this is a SOL or token transfer
    const isTokenTransfer = token.toUpperCase() !== "SOL";
    if (isTokenTransfer) {
      console.log(`Token transfer: ${token}`);
      console.log(`Amount to send: ${amount} tokens`);
    } else {
      console.log(`Amount to send: ${amount} SOL`);
    }

    // Validate inputs and connect
    if (isNaN(amount) || amount <= 0) {
      throw new Error(`Amount must be a positive number`);
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

    // Validate token first if it's a token transfer
    let tokenInfo;
    if (isTokenTransfer) {
      console.log("Validating token address...");
      tokenInfo = await validateTokenAddress(connection, token, network);
      console.log("✓ Token address validated");
    }

    // Create sender keypair
    const senderKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(SENDER_WALLET_SECRET))
    );
    const senderPubKey = senderKeypair.publicKey;
    console.log("Sender wallet address:", senderPubKey.toString());

    // Validate sender wallet
    console.log("Validating sender wallet...");
    await validateWalletAddress(
      connection,
      senderPubKey.toString(),
      "sender",
      network
    );
    console.log("✓ Sender wallet validated");

    // Validate recipient address
    console.log("Validating recipient wallet...");
    const recipientPubKey = await validateWalletAddress(
      connection,
      recipientWalletAddress,
      "recipient",
      network
    );
    console.log("✓ Recipient wallet validated");

    // Create transaction
    console.log("Creating transaction...");
    const transaction = new Transaction();

    if (isTokenTransfer && tokenInfo) {
      // Token transfer
      try {
        // Check sender token balance
        console.log("Checking sender token balance...");
        const senderBalance = await validateSenderTokenBalance(
          connection,
          senderPubKey,
          tokenInfo.mint,
          amount,
          network
        );

        // Format balance for display with proper decimal places
        const senderBalanceFormatted =
          Number(senderBalance) / 10 ** tokenInfo.decimals;
        console.log(
          `Sender token balance: ${senderBalanceFormatted.toLocaleString()} ${token} (${senderBalance.toString()} raw)`
        );
        console.log("✓ Sufficient token balance confirmed");

        // Check recipient token account if it exists
        console.log("Checking recipient token account...");
        let recipientHasTokenAccount = false;
        try {
          const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            Keypair.generate(), // Dummy keypair for read-only operation
            tokenInfo.mint,
            recipientPubKey,
            false // Don't create if it doesn't exist
          );

          if (recipientTokenAccount) {
            recipientHasTokenAccount = true;
            const recipientAccountInfo = await getAccount(
              connection,
              recipientTokenAccount.address
            );
            const recipientBalance = recipientAccountInfo.amount;
            const recipientBalanceFormatted =
              Number(recipientBalance) / 10 ** tokenInfo.decimals;
            console.log(
              `Recipient token balance: ${recipientBalanceFormatted.toLocaleString()} ${token} (${recipientBalance.toString()} raw)`
            );
          }
        } catch (error) {
          recipientHasTokenAccount = false;
          console.log(
            "Recipient doesn't have a token account yet. It will be created during transfer."
          );
          console.log(
            `This will require an additional ~${
              TOKEN_ACCOUNT_CREATION_COST / LAMPORTS_PER_SOL
            } SOL from the sender for account creation.`
          );
        }

        // Check SOL balance for transaction fees
        console.log("Checking sender SOL balance for transaction fees...");
        await validateSenderBalance(
          connection,
          senderPubKey,
          0, // No SOL transfer, just need fees
          network,
          !recipientHasTokenAccount // May need token account if recipient doesn't have one
        );
        console.log("✓ Sufficient SOL balance for fees confirmed");

        // Get sender token account
        const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          senderKeypair,
          tokenInfo.mint,
          senderPubKey
        );

        // Get or create recipient token account
        const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          senderKeypair,
          tokenInfo.mint,
          recipientPubKey,
          true // Always create if it doesn't exist
        );

        console.log(
          `Recipient token account: ${recipientTokenAccount.address.toString()}`
        );
        console.log(`✓ Recipient token account is ready for transfer`);

        // Convert amount to token amount considering decimals
        const tokenAmount = BigInt(
          Math.floor(amount * 10 ** tokenInfo.decimals)
        );
        console.log(
          `Amount to send: ${amount.toLocaleString()} ${token} (${tokenAmount.toString()} raw)`
        );

        // Add token transfer instruction
        transaction.add(
          createTransferInstruction(
            senderTokenAccount.address,
            recipientTokenAccount.address,
            senderPubKey,
            tokenAmount,
            [],
            TOKEN_PROGRAM_ID
          )
        );
      } catch (error) {
        throw new Error(
          `Failed to set up token transfer: ${
            error instanceof Error ? error.message : String(error)
          }. This may be due to insufficient SOL in the sender's account to create a token account for the recipient. Please ensure the sender has enough SOL to cover transaction fees and token account creation.`
        );
      }
    } else {
      // SOL transfer
      // Check sender balance
      console.log("Checking sender SOL balance...");
      const requiredAmount = amount * LAMPORTS_PER_SOL;
      const senderBalance = await validateSenderBalance(
        connection,
        senderPubKey,
        requiredAmount,
        network,
        false // No need for token account
      );
      console.log(
        `Sender SOL balance: ${senderBalance / LAMPORTS_PER_SOL} SOL`
      );
      console.log("✓ Sufficient balance confirmed");

      // Check recipient SOL balance
      console.log("Checking recipient SOL balance...");
      const recipientBalance = await connection.getBalance(recipientPubKey);
      console.log(
        `Recipient SOL balance: ${recipientBalance / LAMPORTS_PER_SOL} SOL`
      );

      // Add SOL transfer instruction
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: senderPubKey,
          toPubkey: recipientPubKey,
          lamports: amount * LAMPORTS_PER_SOL,
        })
      );
    }

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
    if (isTokenTransfer && tokenInfo) {
      console.log(
        `Successfully sent ${amount} ${token} tokens to ${recipientWalletAddress} on ${network}`
      );

      // Check final balances after transfer
      console.log("\nChecking final balances after transfer...");

      try {
        // Check sender's final token balance
        const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          senderKeypair,
          tokenInfo.mint,
          senderPubKey,
          false
        );

        if (senderTokenAccount) {
          const senderAccountInfo = await getAccount(
            connection,
            senderTokenAccount.address
          );
          const senderBalance = senderAccountInfo.amount;
          const senderBalanceFormatted =
            Number(senderBalance) / 10 ** tokenInfo.decimals;
          console.log(
            `Sender's final token balance: ${senderBalanceFormatted.toLocaleString()} ${token} (${senderBalance.toString()} raw)`
          );
        }

        // Check recipient's final token balance
        const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          Keypair.generate(), // Dummy keypair for read-only operation
          tokenInfo.mint,
          recipientPubKey,
          false
        );

        if (recipientTokenAccount) {
          const recipientAccountInfo = await getAccount(
            connection,
            recipientTokenAccount.address
          );
          const recipientBalance = recipientAccountInfo.amount;
          const recipientBalanceFormatted =
            Number(recipientBalance) / 10 ** tokenInfo.decimals;
          console.log(
            `Recipient's final token balance: ${recipientBalanceFormatted.toLocaleString()} ${token} (${recipientBalance.toString()} raw)`
          );
        }
      } catch (error) {
        console.log(
          "Could not check final balances:",
          error instanceof Error ? error.message : String(error)
        );
      }
    } else {
      console.log(
        `Successfully sent ${amount} SOL to ${recipientWalletAddress} on ${network}`
      );

      // Check final SOL balances after transfer
      console.log("\nChecking final balances after transfer...");
      try {
        const senderBalance = await connection.getBalance(senderPubKey);
        console.log(
          `Sender's final SOL balance: ${(
            senderBalance / LAMPORTS_PER_SOL
          ).toLocaleString()} SOL (${senderBalance.toString()} lamports)`
        );

        const recipientBalance = await connection.getBalance(recipientPubKey);
        console.log(
          `Recipient's final SOL balance: ${(
            recipientBalance / LAMPORTS_PER_SOL
          ).toLocaleString()} SOL (${recipientBalance.toString()} lamports)`
        );
      } catch (error) {
        console.log(
          "Could not check final balances:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    console.log(`Transaction signature: ${signature}`);
    console.log(
      `Explorer URL: https://explorer.solana.com/tx/${signature}?cluster=${network}`
    );
    console.log(
      `Solscan URL: https://solscan.io/tx/${signature}?cluster=${network}`
    );

    // Set success output
    setOutput("success", "true");

    // Set transaction signature output
    setOutput("transaction", signature);
  } catch (error) {
    // Set error output and success as false
    setOutput("success", "false");
    setOutput("error", error instanceof Error ? error.message : String(error));
    setOutput("transaction", "");

    console.error(
      "❌ Error:",
      error instanceof Error ? error.message : String(error)
    );
    setFailed(error instanceof Error ? error.message : String(error));
  }
}

main();
