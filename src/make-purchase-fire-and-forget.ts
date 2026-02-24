/**
 * Gasless purchase using signAndSendTransaction (one-step, fire-and-forget).
 *
 * Kora co-signs AND broadcasts the transaction in a single RPC call.
 * Simpler, but does not return a transaction signature for confirmation.
 */
import { buildPurchaseTransaction } from "./build-purchase-tx.js";

async function main() {
  const { transaction, kora } = await buildPurchaseTransaction();

  console.log("\n[6/6] Sending to Kora for co-signing & broadcast");

  const result = await kora.signAndSendTransaction({ transaction });
  console.log("  Kora co-signed and sent the transaction");
  console.log("  Signer:", result.signer_pubkey);

  console.log("\n========================================");
  console.log("  SUCCESS — Purchase sent!");
  console.log("========================================");
  console.log(
    "\nNote: signAndSendTransaction does not return the tx signature.",
    "\nUse the two-step 'make-purchase' script if you need confirmation."
  );
}

main().catch((err) => {
  console.error("\nFailed:", err);
  process.exit(1);
});
