/**
 * Demo: using the Codama-generated Kit plugin to call the let-me-buy program.
 *
 * This shows how clean program interaction becomes with the plugin pattern —
 * no manual PDA derivation, no Borsh encoding, just typed function calls.
 * Runs against the local test validator (normal tx, no Kora).
 */
import {
  createKeyPairSignerFromBytes,
  getBase58Encoder,
  address,
} from "@solana/kit";
import { createDefaultRpcClient } from "@solana/kit-plugins";
import { letMeBuyProgram } from "../clients/js/src/generated/index.js";
import dotenv from "dotenv";

dotenv.config();

const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const wsUrl = process.env.SOLANA_WS_URL ?? "ws://127.0.0.1:8900";

async function main() {
  console.log("\n========================================");
  console.log("  Kit Plugin Demo — let-me-buy");
  console.log("========================================\n");

  const secret = process.env.BUYER_KEYPAIR;
  if (!secret) throw new Error("BUYER_KEYPAIR not set");
  const payer = await createKeyPairSignerFromBytes(
    getBase58Encoder().encode(secret),
  );

  const storeName = process.env.STORE_NAME ?? "kora-test-store";
  const productName = process.env.PRODUCT_NAME ?? "coffee";
  const tableNumber = Number(process.env.TABLE_NUMBER ?? "1");
  const storeAuthority = address(process.env.STORE_AUTHORITY!);
  const mint = address(process.env.USDC_MINT!);

  console.log("Buyer:", payer.address);
  console.log("Store:", storeName);
  console.log("Product:", productName);
  console.log("Mint:", mint);

  console.log("\nSending makePurchase via plugin...\n");

  const client = createDefaultRpcClient({
    url: rpcUrl,
    payer: payer,
    rpcSubscriptionsConfig: { url: wsUrl },
  }).use(letMeBuyProgram());

  const result = await client.letMeBuy.instructions
    .makePurchase({
      signer: payer,
      authority: storeAuthority,
      mint,
      storeName,
      productName,
      tableNumber,
    })
    .sendTransaction();

  console.log("========================================");
  console.log("  Purchase confirmed!");
  console.log("========================================\n");
  console.log("Signature:", result.context.signature);
  console.log(
    `Explorer:  https://explorer.solana.com/tx/${result.context.signature}`,
  );
}

main().catch((err) => {
  console.error("\nFailed:", err);
  process.exit(1);
});
