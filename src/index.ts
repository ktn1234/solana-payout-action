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
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAccount,
  getMint,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import bs58 from "bs58";

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
// We round up to 0.003 SOL to provide a small buffer
const TOKEN_ACCOUNT_CREATION_COST = 0.003 * LAMPORTS_PER_SOL; // 0.003 SOL for token account creation

// Buffer requirements summary:
// - SOL transfers: 0.1 SOL buffer for transaction fees
// - SPL token transfers: 0.1 SOL buffer + up to 0.006 SOL for token account creation
//   (0.003 SOL per account if needed for both sender and recipient)

interface TokenInfo {
  mint: PublicKey;
  supply: bigint;
  decimals: number;
}

interface SenderTokenInfo {
  balance: bigint;
  hasTokenAccount: boolean;
}

/**
 * SolanaPayoutService - A class to handle Solana payments
 * Encapsulates all the business logic for sending SOL or SPL tokens
 */
class SolanaPayoutService {
  private connection: Connection;
  private senderKeypair: Keypair;
  private senderPubKey: PublicKey;
  private recipientPubKey: PublicKey;
  private amount: number;
  private network: string;
  private token: string;
  private isTokenTransfer: boolean;
  private tokenInfo: TokenInfo | null = null;

  /**
   * Constructor for SolanaPayoutService
   * @param senderWalletSecret - The sender's wallet private key in base58 format
   * @param recipientWalletAddress - The recipient's wallet address
   * @param amount - The amount to send
   * @param token - The token to send (SOL or SPL token address)
   * @param network - The Solana network to use
   */
  constructor(
    senderWalletSecret: string,
    recipientWalletAddress: string,
    amount: number,
    token: string,
    network: string
  ) {
    // Validate inputs
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

    // Initialize properties
    this.amount = amount;
    this.token = token;
    this.network = network;
    this.isTokenTransfer = token.toUpperCase() !== "SOL";
    this.connection = new Connection(NETWORK_URLS[network]);

    // Create sender keypair
    try {
      const privateKeyBytes = bs58.decode(senderWalletSecret);
      this.senderKeypair = Keypair.fromSecretKey(privateKeyBytes);
      this.senderPubKey = this.senderKeypair.publicKey;
    } catch (error: any) {
      throw new Error(
        "Invalid wallet secret format. Please provide a valid base58 encoded private key."
      );
    }

    // Initialize recipient public key (will be validated later)
    try {
      this.recipientPubKey = new PublicKey(recipientWalletAddress);
    } catch (error) {
      throw new Error(
        `Invalid recipient wallet address format: ${recipientWalletAddress}`
      );
    }
  }

  /**
   * Validates a wallet address
   * @param address - The wallet address to validate
   * @param type - The type of wallet (sender or recipient)
   * @returns The validated PublicKey
   */
  private async validateWalletAddress(
    address: string,
    type: string = "wallet"
  ): Promise<PublicKey> {
    try {
      const pubKey = new PublicKey(address);

      // Check if address is valid Solana public key format
      if (!PublicKey.isOnCurve(pubKey)) {
        throw new Error(`Invalid ${type} wallet address format: ${address}`);
      }

      // For basic SOL accounts, we should check balance instead of account info
      const balance = await this.connection.getBalance(pubKey);
      const solBalance = balance / LAMPORTS_PER_SOL;
      console.log(
        `${type} wallet balance: ${solBalance.toLocaleString()} SOL (${balance.toString()} lamports)`
      );

      // We don't throw if balance is 0, just log it
      if (balance === 0) {
        console.log(
          `Warning: ${type} wallet has 0 balance on ${this.network} network`
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

  /**
   * Validates the sender's SOL balance
   * @param requiredAmount - The amount of SOL required
   * @param tokenAccountsToCreate - Number of token accounts that may need to be created
   * @returns The sender's SOL balance
   */
  private async validateSenderBalance(
    requiredAmount: number,
    tokenAccountsToCreate: number = 0
  ): Promise<number> {
    try {
      const balance = await this.connection.getBalance(this.senderPubKey);

      // Calculate total required with a conservative fee buffer
      let totalRequired = requiredAmount + TRANSACTION_FEE_BUFFER;

      // Add token account creation costs if needed
      let tokenAccountCost = 0;
      if (tokenAccountsToCreate > 0) {
        tokenAccountCost = TOKEN_ACCOUNT_CREATION_COST * tokenAccountsToCreate;
        totalRequired += tokenAccountCost;
        console.log(
          `Including cost for ${tokenAccountsToCreate} token account${
            tokenAccountsToCreate > 1 ? "s" : ""
          } creation: ${(tokenAccountCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`
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
        `Transaction fee buffer: ${feeBuffer.toLocaleString()} SOL (${TRANSACTION_FEE_BUFFER.toString()} lamports)`
      );

      if (tokenAccountsToCreate > 0) {
        console.log(
          `Token account creation cost: ${(
            tokenAccountCost / LAMPORTS_PER_SOL
          ).toFixed(6)} SOL (${tokenAccountCost.toString()} lamports)`
        );
      }

      console.log(
        `Total required: ${solTotalRequired.toLocaleString()} SOL (${totalRequired.toString()} lamports)`
      );

      if (balance < totalRequired) {
        throw new Error(
          `Insufficient funds in sender wallet on ${this.network} network. ` +
            `Balance: ${solBalance.toLocaleString()} SOL, ` +
            `Required: ${solTotalRequired.toLocaleString()} SOL ` +
            `(including ${feeBuffer.toLocaleString()} SOL buffer for transaction fees${
              tokenAccountsToCreate > 0
                ? ` and ${(tokenAccountCost / LAMPORTS_PER_SOL).toFixed(
                    6
                  )} SOL for ${tokenAccountsToCreate} token account${
                    tokenAccountsToCreate > 1 ? "s" : ""
                  } creation`
                : ""
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

  /**
   * Validates the sender's token balance
   * @param tokenMint - The token mint
   * @param requiredAmount - The amount of tokens required
   * @returns Information about the sender's token account and balance
   */
  private async validateSenderTokenBalance(
    tokenMint: PublicKey,
    requiredAmount: number
  ): Promise<SenderTokenInfo> {
    try {
      // Try to get the associated token account for the sender
      let tokenAccount;
      let hasTokenAccount = true;

      try {
        // Get the associated token account for the sender
        tokenAccount = await getOrCreateAssociatedTokenAccount(
          this.connection,
          Keypair.generate(), // Dummy keypair for read-only operation
          tokenMint,
          this.senderPubKey,
          false // Don't create if it doesn't exist
        );
      } catch (error) {
        // If the token account doesn't exist, mark it
        hasTokenAccount = false;
        console.log(
          `No token account found for token ${tokenMint.toString()} in sender wallet on ${
            this.network
          } network`
        );
        console.log(
          "A token account will be created for the sender during the transfer"
        );

        // Return with zero balance and hasTokenAccount = false
        return { balance: BigInt(0), hasTokenAccount };
      }

      if (!tokenAccount) {
        hasTokenAccount = false;
        console.log(
          `No token account found for token ${tokenMint.toString()} in sender wallet on ${
            this.network
          } network`
        );
        console.log(
          "A token account will be created for the sender during the transfer"
        );

        // Return with zero balance and hasTokenAccount = false
        return { balance: BigInt(0), hasTokenAccount };
      }

      // Get the token account info
      const accountInfo = await getAccount(
        this.connection,
        tokenAccount.address
      );
      const balance = accountInfo.amount;

      // Get token mint info to determine decimals
      const mintInfo = await getMint(this.connection, tokenMint);
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
          `Insufficient token balance in sender wallet on ${this.network} network. ` +
            `Balance: ${balanceFormatted} tokens, ` +
            `Required: ${requiredFormatted} tokens`
        );
      }

      return { balance, hasTokenAccount };
    } catch (error) {
      // Re-throw if it's an insufficient balance error
      if (
        error instanceof Error &&
        error.message.includes("Insufficient token balance")
      ) {
        throw error;
      }

      // For other errors, provide a more detailed message
      throw new Error(
        `Failed to check sender token balance: ${
          error instanceof Error ? error.message : String(error)
        }. This may be due to insufficient SOL in the sender's account to create a token account for the recipient. Please ensure the sender has enough SOL to cover transaction fees and token account creation.`
      );
    }
  }

  /**
   * Validates a token address
   * @param tokenAddress - The token address to validate
   * @returns Information about the token
   */
  private async validateTokenAddress(tokenAddress: string): Promise<TokenInfo> {
    try {
      try {
        // Validate token mint address
        console.log(`Validating token address: ${tokenAddress}`);
        const tokenMint = new PublicKey(tokenAddress);

        // Get token mint info
        const mintInfo = await getMint(this.connection, tokenMint);
        console.log(`Token supply: ${mintInfo.supply.toString()}`);
        console.log(`Token decimals: ${mintInfo.decimals}`);

        // Check if token is frozen
        if (mintInfo.freezeAuthority) {
          console.log(
            `Freeze authority: ${mintInfo.freezeAuthority.toString()} (freezable)`
          );
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
      if (
        error instanceof Error &&
        error.message.includes("Invalid SPL token")
      ) {
        throw error;
      }
      throw new Error(
        `Failed to validate token address: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Initializes the service by validating wallets and token information
   */
  public async initialize(): Promise<void> {
    console.log("Starting Solana payment process...");
    console.log(`Network: ${this.network}`);
    console.log(`Connecting to Solana ${this.network}...`);
    console.log("✓ Connected to network");

    // Log transaction type and amount
    if (this.isTokenTransfer) {
      console.log(`Token transfer: ${this.token}`);
      console.log(`Amount to send: ${this.amount} tokens`);
    } else {
      console.log(`SOL transfer`);
      console.log(`Amount to send: ${this.amount} SOL`);
    }

    console.log("Sender wallet address:", this.senderPubKey.toString());

    // Validate sender wallet
    console.log("Validating sender wallet...");
    await this.validateWalletAddress(this.senderPubKey.toString(), "sender");
    console.log("✓ Sender wallet validated");

    // Validate recipient address
    console.log("Validating recipient wallet...");
    await this.validateWalletAddress(
      this.recipientPubKey.toString(),
      "recipient"
    );
    console.log("✓ Recipient wallet validated");

    // Validate token if it's a token transfer
    if (this.isTokenTransfer) {
      console.log("Validating token address...");
      this.tokenInfo = await this.validateTokenAddress(this.token);
      console.log("✓ Token address validated");
    }
  }

  /**
   * Executes a SOL transfer
   * @returns The transaction signature
   */
  private async executeSolTransfer(): Promise<string> {
    console.log("Executing SOL transfer...");

    // Check sender SOL balance
    console.log("Checking sender SOL balance...");
    await this.validateSenderBalance(
      this.amount * LAMPORTS_PER_SOL,
      0 // No token accounts needed for SOL transfer
    );
    console.log("✓ Sufficient SOL balance confirmed");

    // Create transaction
    console.log("Creating transaction...");
    const transaction = new Transaction();

    // Add transfer instruction
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: this.senderPubKey,
        toPubkey: this.recipientPubKey,
        lamports: this.amount * LAMPORTS_PER_SOL,
      })
    );

    // Send transaction
    console.log("Sending transaction...");
    const signature = await this.connection.sendTransaction(transaction, [
      this.senderKeypair,
    ]);

    console.log("Transaction sent with signature:", signature);
    console.log(
      `View on Solana Explorer: https://explorer.solana.com/tx/${signature}?cluster=${this.network}`
    );

    // Wait for confirmation
    console.log("Waiting for confirmation...");
    const confirmation = await this.connection.confirmTransaction(signature);

    if (confirmation.value.err) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
      );
    }

    console.log("✓ Transaction confirmed");
    return signature;
  }

  /**
   * Executes a token transfer
   * @returns The transaction signature
   */
  private async executeTokenTransfer(): Promise<string> {
    if (!this.tokenInfo) {
      throw new Error("Token information not initialized");
    }

    console.log("Executing token transfer...");

    // Check if recipient has a token account already
    let recipientHasTokenAccount = true;
    try {
      const recipientTokenAccountAddress = await getAssociatedTokenAddress(
        this.tokenInfo.mint,
        this.recipientPubKey
      );
      const recipientTokenAccountInfo = await this.connection.getAccountInfo(
        recipientTokenAccountAddress
      );
      recipientHasTokenAccount = recipientTokenAccountInfo !== null;
      if (recipientHasTokenAccount) {
        console.log("Recipient already has a token account");
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

    // Check if sender has a token account and sufficient token balance
    console.log("Checking sender token balance...");
    const senderTokenInfo = await this.validateSenderTokenBalance(
      this.tokenInfo.mint,
      this.amount
    );

    // Determine if we need to create token accounts
    const needSenderTokenAccount = !senderTokenInfo.hasTokenAccount;
    const needRecipientTokenAccount = !recipientHasTokenAccount;
    const accountsToCreate =
      (needSenderTokenAccount ? 1 : 0) + (needRecipientTokenAccount ? 1 : 0);

    if (needSenderTokenAccount) {
      console.log(
        "Sender doesn't have a token account yet. It will be created during transfer."
      );
      console.log(
        `This will require an additional ~${
          TOKEN_ACCOUNT_CREATION_COST / LAMPORTS_PER_SOL
        } SOL from the sender for account creation.`
      );
    }

    // Format balance for display with proper decimal places
    const senderBalanceFormatted =
      Number(senderTokenInfo.balance) / 10 ** this.tokenInfo.decimals;
    console.log(
      `Sender token balance: ${senderBalanceFormatted.toLocaleString()} ${
        this.token
      } (${senderTokenInfo.balance.toString()} raw)`
    );
    console.log("✓ Sufficient token balance confirmed");

    // Check SOL balance for transaction fees
    console.log("Checking sender SOL balance for transaction fees...");
    await this.validateSenderBalance(
      0, // No SOL transfer, just need fees
      accountsToCreate // Number of token accounts that may need to be created
    );
    console.log("✓ Sufficient SOL balance for fees confirmed");

    // Get or create sender token account
    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.senderKeypair,
      this.tokenInfo.mint,
      this.senderPubKey,
      true // Create if it doesn't exist
    );

    // Get or create recipient token account
    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.senderKeypair,
      this.tokenInfo.mint,
      this.recipientPubKey,
      true // Always create if it doesn't exist
    );

    console.log(
      `Recipient token account: ${recipientTokenAccount.address.toString()}`
    );
    console.log(`✓ Recipient token account is ready for transfer`);

    // Convert amount to token amount considering decimals
    const tokenAmount = BigInt(
      Math.floor(this.amount * 10 ** this.tokenInfo.decimals)
    );
    console.log(
      `Amount to send: ${this.amount.toLocaleString()} ${
        this.token
      } (${tokenAmount.toString()} raw)`
    );

    // Create transaction
    console.log("Creating transaction...");
    const transaction = new Transaction();

    // Add transfer instruction
    transaction.add(
      createTransferInstruction(
        senderTokenAccount.address,
        recipientTokenAccount.address,
        this.senderPubKey,
        tokenAmount
      )
    );

    // Send transaction
    console.log("Sending transaction...");
    const signature = await this.connection.sendTransaction(transaction, [
      this.senderKeypair,
    ]);

    console.log("Transaction sent with signature:", signature);
    console.log(
      `View on Solana Explorer: https://explorer.solana.com/tx/${signature}?cluster=${this.network}`
    );

    // Wait for confirmation
    console.log("Waiting for confirmation...");
    const confirmation = await this.connection.confirmTransaction(signature);

    if (confirmation.value.err) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
      );
    }

    console.log("✓ Transaction confirmed");
    return signature;
  }

  /**
   * Executes the payment
   * @returns The transaction signature
   */
  public async executePayment(): Promise<string> {
    // Store token account creation info for SPL transfers
    let createdSenderTokenAccount = false;
    let createdRecipientTokenAccount = false;

    // Execute the appropriate transfer type
    let signature: string;

    if (this.isTokenTransfer) {
      // Execute token transfer
      signature = await this.executeTokenTransfer();

      // For token transfers, check if we created token accounts
      if (this.tokenInfo) {
        try {
          // Check if sender token account was just created
          const senderTokenAddress = await getAssociatedTokenAddress(
            this.tokenInfo.mint,
            this.senderPubKey
          );
          const senderAccountInfo = await this.connection.getAccountInfo(
            senderTokenAddress
          );
          if (senderAccountInfo && senderAccountInfo.lamports > 0) {
            createdSenderTokenAccount = true;
          }

          // Check if recipient token account was just created
          const recipientTokenAddress = await getAssociatedTokenAddress(
            this.tokenInfo.mint,
            this.recipientPubKey
          );
          const recipientAccountInfo = await this.connection.getAccountInfo(
            recipientTokenAddress
          );
          if (recipientAccountInfo && recipientAccountInfo.lamports > 0) {
            createdRecipientTokenAccount = true;
          }
        } catch (error) {
          // Ignore errors in this optional check
          console.log(
            "Note: Could not determine if token accounts were created"
          );
        }
      }
    } else {
      // Execute SOL transfer
      signature = await this.executeSolTransfer();
    }

    // Print transaction summary
    console.log("\n🎉 Transaction Summary:");
    console.log(
      `Type: ${
        this.isTokenTransfer ? `${this.token} Token Transfer` : "SOL Transfer"
      }`
    );
    console.log(
      `Amount: ${this.amount} ${this.isTokenTransfer ? this.token : "SOL"}`
    );
    console.log(`From: ${this.senderPubKey.toString()}`);
    console.log(`To: ${this.recipientPubKey.toString()}`);
    console.log(`Network: ${this.network}`);

    // Add token account creation info if applicable
    if (this.isTokenTransfer) {
      if (createdSenderTokenAccount) {
        console.log(
          `✓ Created token account for sender (cost: ${(
            TOKEN_ACCOUNT_CREATION_COST / LAMPORTS_PER_SOL
          ).toFixed(6)} SOL)`
        );
      }
      if (createdRecipientTokenAccount) {
        console.log(
          `✓ Created token account for recipient (cost: ${(
            TOKEN_ACCOUNT_CREATION_COST / LAMPORTS_PER_SOL
          ).toFixed(6)} SOL)`
        );
      }
    }

    console.log(`Transaction signature: ${signature}`);
    console.log(
      `View on Solana Explorer: https://explorer.solana.com/tx/${signature}?cluster=${this.network}`
    );
    console.log(
      `View on Solscan: https://solscan.io/tx/${signature}?cluster=${this.network}`
    );

    return signature;
  }
}

/**
 * Main function to execute the GitHub Action
 */
async function main(): Promise<void> {
  try {
    // Get sender wallet secret from environment variables
    const senderWalletSecret = process.env.SENDER_WALLET_SECRET;
    if (!senderWalletSecret) {
      throw new Error(
        "Environment variable SENDER_WALLET_SECRET is not set, please set it in the repository secrets"
      );
    }

    // Get inputs from the GitHub Action
    const recipientWalletAddress = getInput("recipient-wallet-address", {
      required: true,
    });
    const amount = parseFloat(getInput("amount", { required: true }));
    const network = getInput("network", { required: false }) || "mainnet-beta";
    const token = getInput("token", { required: true });

    // Create, initialize, and execute the payment service
    const payoutService = new SolanaPayoutService(
      senderWalletSecret,
      recipientWalletAddress,
      amount,
      token,
      network
    );

    await payoutService.initialize();
    const signature = await payoutService.executePayment();

    // Set outputs for GitHub Actions
    setOutput("success", "true");
    setOutput("error", "");
    setOutput("transaction", signature);
  } catch (error) {
    console.error(
      "❌ Error:",
      error instanceof Error ? error.message : String(error)
    );

    // Set outputs for GitHub Actions
    setOutput("success", "false");
    setOutput("error", error instanceof Error ? error.message : String(error));
    setOutput("transaction", "");

    setFailed(error instanceof Error ? error.message : String(error));
  }
}

// Run the main function
main();
