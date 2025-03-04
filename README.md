# Solana Payout Action

A GitHub Action to automatically send Solana payments to specified wallet addresses.

## Features

- Send SOL or SPL tokens to any valid Solana wallet address
- Support for multiple Solana networks (mainnet-beta, devnet, testnet)
- Validates wallet addresses and balances before transactions
- Comprehensive error handling and validation

## Usage

```yaml
# Send SOL
- uses: UraniumCorporation/solana-payout-action@v1
  with:
    recipient-wallet-address: "RECIPIENT_WALLET_ADDRESS"
    amount: "1.5" # Amount in SOL
    token: "SOL"
    network: "mainnet-beta" # Optional (default: mainnet-beta)
  env:
    SENDER_WALLET_SECRET: ${{ secrets.SENDER_WALLET_SECRET }}

# Send SPL Tokens
- uses: UraniumCorporation/solana-payout-action@v1
  with:
    recipient-wallet-address: "RECIPIENT_WALLET_ADDRESS"
    amount: "10" # Amount in tokens
    token: "TOKEN_ADDRESS" # SPL token address
    network: "mainnet-beta" # Optional (default: mainnet-beta)
  env:
    SENDER_WALLET_SECRET: ${{ secrets.SENDER_WALLET_SECRET }}
```

## Inputs

| Input                      | Description                                           | Required | Default      |
| -------------------------- | ----------------------------------------------------- | -------- | ------------ |
| `recipient-wallet-address` | Solana wallet address to receive the payment          | Yes      | -            |
| `amount`                   | Amount to send (in SOL or tokens)                     | Yes      | -            |
| `token`                    | Token to send - either 'SOL' or an SPL token address  | Yes      | -            |
| `network`                  | Solana network to use (mainnet-beta, devnet, testnet) | No       | mainnet-beta |

## Environment Variables

| Variable               | Description                                           | Required |
| ---------------------- | ----------------------------------------------------- | -------- |
| `SENDER_WALLET_SECRET` | Private key of the sender's wallet (as a JSON string) | Yes      |

## Setup

1. Create a Solana wallet to use as the sender
2. Add the wallet's private key as a repository secret named `SENDER_WALLET_SECRET`
3. Ensure the sender wallet has sufficient SOL for the transactions
4. If sending SPL tokens, ensure the sender wallet has the tokens and SOL for transaction fees

## Example Workflow

### Basic SOL Payment

```yaml
name: Send SOL Payment
on:
  workflow_dispatch:
    inputs:
      recipient:
        description: "Recipient wallet address"
        required: true
      amount:
        description: "Amount in SOL"
        required: true

jobs:
  send-payment:
    runs-on: ubuntu-latest
    steps:
      - uses: UraniumCorporation/solana-payout-action@v1
        with:
          recipient-wallet-address: ${{ inputs.recipient }}
          amount: ${{ inputs.amount }}
          token: "SOL"
          network: "mainnet-beta"
        env:
          SENDER_WALLET_SECRET: ${{ secrets.SENDER_WALLET_SECRET }}
```

### Token Payment Example

```yaml
name: Send Token Payment
on:
  workflow_dispatch:
    inputs:
      recipient:
        description: "Recipient wallet address"
        required: true
      amount:
        description: "Amount of tokens"
        required: true
      token:
        description: "Token address"
        required: true

jobs:
  send-token-payment:
    runs-on: ubuntu-latest
    steps:
      - uses: UraniumCorporation/solana-payout-action@v1
        with:
          recipient-wallet-address: ${{ inputs.recipient }}
          amount: ${{ inputs.amount }}
          token: ${{ inputs.token }}
          network: "mainnet-beta"
        env:
          SENDER_WALLET_SECRET: ${{ secrets.SENDER_WALLET_SECRET }}
```

### Use Case: Automated PR Reward System

This example shows how to automatically pay contributors when their PR is merged.

#### Pull Request Format Requirements

Contributors must include their Solana wallet address in the PR description using this format:

```
## Wallet Address
solana:ABC123...XYZ
```

Example PR description:

```markdown
Fixed bug in authentication module

## Wallet Address

solana:HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH
```

#### Workflow Configuration

```yaml
name: Pay Contributor
on:
  pull_request:
    types: [closed]

jobs:
  pay-contributor:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      # Extract wallet address from PR description
      - name: Extract wallet address
        id: extract-wallet
        run: |
          DESCRIPTION="${{ github.event.pull_request.body }}"
          WALLET=$(echo "$DESCRIPTION" | grep -o 'solana:[A-Za-z0-9]\{32,\}' | cut -d':' -f2)
          echo "wallet=$WALLET" >> $GITHUB_OUTPUT

      - uses: UraniumCorporation/solana-payout-action@v1
        with:
          recipient-wallet-address: ${{ steps.extract-wallet.outputs.wallet }}
          amount: "1.0"
          token: "SOL" # Pay in SOL
          network: "mainnet-beta"
        env:
          SENDER_WALLET_SECRET: ${{ secrets.SENDER_WALLET_SECRET }}
```

### Use Case: Token-Based Reward System

This example shows how to pay contributors with a specific SPL token.

```yaml
name: Pay Contributor with Tokens
on:
  pull_request:
    types: [closed]

jobs:
  pay-contributor-with-tokens:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      # Extract wallet address from PR description
      - name: Extract wallet address
        id: extract-wallet
        run: |
          DESCRIPTION="${{ github.event.pull_request.body }}"
          WALLET=$(echo "$DESCRIPTION" | grep -o 'solana:[A-Za-z0-9]\{32,\}' | cut -d':' -f2)
          echo "wallet=$WALLET" >> $GITHUB_OUTPUT

      - uses: UraniumCorporation/solana-payout-action@v1
        with:
          recipient-wallet-address: ${{ steps.extract-wallet.outputs.wallet }}
          amount: "10.0" # 10 tokens
          token: "YOUR_TOKEN_ADDRESS" # Replace with your token address
          network: "mainnet-beta"
        env:
          SENDER_WALLET_SECRET: ${{ secrets.SENDER_WALLET_SECRET }}
```
