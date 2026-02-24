# Kora Gasless Purchase — let-me-buy

A TypeScript example demonstrating **gasless Solana transactions** using [Kora](https://github.com/solana-foundation/kora) to call the [let-me-buy](https://github.com/Woody4618/bar/tree/main/programs/let-me-buy) on-chain program (`BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya`).

The buyer **never needs SOL**. Kora pays the transaction fee and the buyer reimburses Kora in USDC.

## How It Works

```
Buyer (has USDC, no SOL)
  │
  ├─ 1. Build make_purchase instruction (pays product price in USDC to store)
  ├─ 2. Ask Kora to estimate the gas fee in USDC
  ├─ 3. Append Kora payment instruction (USDC transfer to reimburse Kora)
  ├─ 4. Sign with buyer keypair
  ├─ 5. Send to Kora → Kora co-signs as fee payer → broadcasts to Solana
  └─ 6. Transaction confirmed — buyer paid only USDC, zero SOL
```

## Prerequisites

- **Node.js 20+** and **pnpm**
- **Rust / Cargo** — for installing the Kora CLI
- **Solana CLI v2.2+** — for running a local test validator

## Quick Start (Local Testing)

This sets up everything locally: a test validator with the program, a Kora server, test keypairs, and a local USDC mint.

### 1. Install dependencies

```bash
pnpm install
```

### 2. Install the Kora CLI

```bash
cargo install kora-cli
```

### 3. Start a local Solana test validator

First, dump the `let-me-buy` program from mainnet (one-time):

```bash
solana program dump BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya /tmp/let_me_buy.so --url mainnet-beta
```

Then start the validator with the program loaded:

```bash
solana-test-validator -r \
  --bpf-program BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya /tmp/let_me_buy.so
```

Leave this running in its own terminal.

### 4. Run the setup script

In a second terminal:

```bash
pnpm run setup
```

This will:
- Generate fresh keypairs for the Kora signer, buyer, store authority, and a local USDC mint
- Airdrop SOL to the Kora signer and store authority
- Create the local USDC mint and mint 100 USDC to the buyer and Kora signer
- Initialize a `let-me-buy` store called `kora-test-store` with a "coffee" product priced at 2 USDC
- Write all generated values to `.env` and update `server/kora.toml` with the USDC mint address

At the end it will print an `export KORA_PRIVATE_KEY="..."` command — copy that.

### 5. Start the Kora server

In a third terminal, export the signer key and start Kora:

```bash
export KORA_PRIVATE_KEY="<key printed by setup>"
cd server
kora rpc initialize-atas --signers-config signers.toml
kora rpc start --signers-config signers.toml
```

You should see Kora start on `http://localhost:8080`. Verify with:

```bash
curl -s -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getConfig","params":[]}'
```

### 6. Run the gasless purchase

Back in the second terminal:

```bash
pnpm run purchase
```

You should see output like:

```
========================================
  Kora Gasless Purchase — let-me-buy
========================================

[1/6] Initializing clients
[2/6] Loading keypairs
[3/6] Building make_purchase instruction
[4/6] Estimating fee & getting Kora payment instruction
  Kora fee (USDC token units): 44055
[5/6] Building final transaction with payment
[6/6] Sending to Kora for co-signing & broadcast

========================================
  SUCCESS — Purchase confirmed!
========================================

Signature: 3fuNd8eLeAnGePeErCD8VVu9hDJaM...
```

The buyer paid ~2.044 USDC total (2 USDC for the coffee + ~0.044 USDC gas fee to Kora) and **zero SOL**.

## Using with an Existing Store / Mainnet

If you want to skip local setup and point at a real Kora server and existing store:

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Description |
|---|---|
| `KORA_RPC_URL` | URL of your Kora RPC server |
| `SOLANA_RPC_URL` | Solana JSON-RPC endpoint |
| `SOLANA_WS_URL` | Solana WebSocket endpoint |
| `BUYER_KEYPAIR` | Base58-encoded secret key of the buyer wallet |
| `STORE_NAME` | The store's name (used to derive the receipts PDA) |
| `PRODUCT_NAME` | Name of the product to purchase |
| `TABLE_NUMBER` | Table number for the order (1-255) |
| `STORE_AUTHORITY` | Public key of the store owner (receives payment) |
| `USDC_MINT` | USDC mint address (defaults to mainnet USDC) |

Then run:

```bash
pnpm run purchase
```

## Kora Server Configuration

The `server/` directory contains the Kora server config files:

- **`signers.toml`** — defines the keypair Kora uses to pay transaction fees. The `KORA_PRIVATE_KEY` env var must hold the base58-encoded secret key.
- **`kora.toml`** — defines validation rules. The important sections for this example:
  - `allowed_programs` must include the `let-me-buy` program ID (`BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya`)
  - `allowed_spl_paid_tokens` must include the USDC mint so users can pay Kora fees in USDC
  - `price_source` — use `"Mock"` for local testing (assumes 1:1 SOL/token), `"Jupiter"` for mainnet (requires `JUPITER_API_KEY` env var)
  - `validation.price.margin` — the percentage markup Kora charges on gas (0.1 = 10%)

See the [Kora operator docs](https://launch.solana.com/docs/kora/getting-started/quick-start) for the full configuration reference.

## Project Structure

```
├── server/
│   ├── kora.toml              # Kora RPC server configuration
│   └── signers.toml           # Kora signer keypair configuration
├── src/
│   ├── idl/
│   │   └── let_me_buy.json    # Anchor IDL for the on-chain program
│   ├── program.ts             # Instruction builder for make_purchase
│   ├── make-purchase.ts       # Main script: gasless purchase via Kora
│   └── local-setup.ts         # Local test environment setup script
├── .env.example               # Environment variable template
├── package.json
└── tsconfig.json
```

### Key Files

**`src/program.ts`** — Builds the `make_purchase` instruction by manually encoding the Anchor discriminator and borsh-serialized arguments. Derives all required accounts (receipts PDA, buyer/authority ATAs, etc.) using `@solana/kit` v6.

**`src/make-purchase.ts`** — The main example. Follows the [Kora full-demo pattern](https://github.com/solana-foundation/kora/blob/main/examples/getting-started/demo/client/src/full-demo.ts):
1. Builds the program instruction
2. Creates a temporary transaction to estimate fees via `kora.getPaymentInstruction()`
3. Builds the final transaction with both the program instruction and the USDC payment to Kora
4. Partially signs with the buyer's keypair
5. Sends to Kora for co-signing, then submits to the network

**`src/local-setup.ts`** — Bootstraps a full local test environment: generates keypairs, airdrops SOL, creates a test USDC mint, initializes a store with a product, and writes all config files.

## Notes

- The store authority's USDC ATA must already exist. If it doesn't, the program's `init_if_needed` will try to create it at the buyer's expense (requiring SOL). In practice, established stores will have their ATA initialized.
- The buyer needs enough USDC for both the product price and the Kora gas fee.
- Adjust `computeUnitLimit` and `computeUnitPrice` in `make-purchase.ts` based on network conditions.
- The Kora signer wallet needs SOL to pay transaction fees on behalf of users. It gets reimbursed in USDC.
