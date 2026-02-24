/**
 * Gasless purchase using signTransaction + sendTransaction (two-step).
 *
 * Kora co-signs the transaction, then we submit it to Solana ourselves.
 * This gives us the transaction signature for confirmation and explorer links.
 */
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  Base64EncodedWireTransaction,
} from "@solana/kit";
import { createRecentSignatureConfirmationPromiseFactory } from "@solana/transaction-confirmation";
import { buildPurchaseTransaction } from "./build-purchase-tx.js";

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const SOLANA_WS_URL =
  process.env.SOLANA_WS_URL ?? "wss://api.mainnet-beta.solana.com";

async function main() {
  const { transaction, signerAddress, kora } = await buildPurchaseTransaction();

  console.log("\n[6/6] Kora co-signing, then sending to Solana");

  const { signed_transaction } = await kora.signTransaction({
    transaction,
    signer_key: signerAddress,
  });
  console.log("  Kora co-signed the transaction");

  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(SOLANA_WS_URL);

  const signature = await rpc
    .sendTransaction(signed_transaction as Base64EncodedWireTransaction, {
      encoding: "base64",
    })
    .send();

  console.log("  Submitted to network, awaiting confirmation...");

  const confirmTransaction = createRecentSignatureConfirmationPromiseFactory({
    rpc,
    rpcSubscriptions,
  });
  await confirmTransaction({
    commitment: "confirmed",
    signature,
    abortSignal: AbortSignal.timeout(60_000),
  });

  console.log("\n========================================");
  console.log("  SUCCESS — Purchase confirmed!");
  console.log("========================================");
  console.log("\nSignature:", signature);
  console.log(`Explorer:  https://explorer.solana.com/tx/${signature}`);
}

main().catch((err) => {
  console.error("\nFailed:", err);
  process.exit(1);
});
