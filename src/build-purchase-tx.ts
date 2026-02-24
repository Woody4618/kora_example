import { KoraClient } from "@solana/kora";
import {
  createKeyPairSignerFromBytes,
  getBase58Encoder,
  createNoopSigner,
  address,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  partiallySignTransaction,
  Blockhash,
  KeyPairSigner,
  MicroLamports,
  Instruction,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
} from "@solana/kit";
import {
  updateOrAppendSetComputeUnitLimitInstruction,
  updateOrAppendSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getMakePurchaseInstruction } from "./program.js";
import dotenv from "dotenv";

dotenv.config();

const USDC_MINT =
  process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const CONFIG = {
  computeUnitLimit: 300_000,
  computeUnitPrice: 100_000n as MicroLamports,
  koraRpcUrl: process.env.KORA_RPC_URL ?? "http://localhost:8080/",
};

export async function loadBuyerKeypair(): Promise<KeyPairSigner> {
  const secret = process.env.BUYER_KEYPAIR;
  if (!secret) {
    throw new Error(
      "BUYER_KEYPAIR env variable is not set. " +
        "Set it to a base58-encoded Solana secret key."
    );
  }
  return createKeyPairSignerFromBytes(getBase58Encoder().encode(secret));
}

export interface PurchaseTxResult {
  transaction: string;
  signerAddress: string;
  kora: KoraClient;
}

/**
 * Builds a gasless purchase transaction: constructs the make_purchase
 * instruction, estimates Kora fees, appends the USDC payment instruction,
 * and partially signs with the buyer's keypair.
 *
 * Returns the base64-encoded wire transaction ready for Kora to co-sign.
 */
export async function buildPurchaseTransaction(): Promise<PurchaseTxResult> {
  console.log("\n========================================");
  console.log("  Kora Gasless Purchase — let-me-buy");
  console.log("========================================\n");

  const storeName = process.env.STORE_NAME;
  const productName = process.env.PRODUCT_NAME;
  const tableNumber = Number(process.env.TABLE_NUMBER ?? "1");
  const storeAuthority = process.env.STORE_AUTHORITY;

  if (!storeName || !productName || !storeAuthority) {
    throw new Error(
      "Missing required env vars: STORE_NAME, PRODUCT_NAME, STORE_AUTHORITY. " +
        "Copy .env.example to .env and fill in the values."
    );
  }

  console.log("[1/6] Initializing Kora client");
  console.log("  Kora RPC:", CONFIG.koraRpcUrl);

  const kora = new KoraClient({
    rpcUrl: CONFIG.koraRpcUrl,
    // apiKey: process.env.KORA_API_KEY,
    // hmacSecret: process.env.KORA_HMAC_SECRET,
  });

  console.log("\n[2/6] Loading keypairs");
  const buyer = await loadBuyerKeypair();
  const { signer_address } = await kora.getPayerSigner();
  console.log("  Buyer:", buyer.address);
  console.log("  Kora fee payer:", signer_address);

  console.log("\n[3/6] Building make_purchase instruction");
  console.log("  Store:", storeName);
  console.log("  Product:", productName);
  console.log("  Table:", tableNumber);
  console.log("  Mint (USDC):", USDC_MINT);

  const purchaseIx = await getMakePurchaseInstruction({
    storeName,
    productName,
    tableNumber,
    buyer: buyer.address,
    storeAuthority: address(storeAuthority),
    mint: address(USDC_MINT),
  });
  const instructions: Instruction[] = [purchaseIx];

  console.log("\n[4/6] Estimating fee & getting Kora payment instruction");
  const noopSigner = createNoopSigner(address(signer_address));
  const estimateBlockhash = await kora.getBlockhash();

  const estimateTx = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(noopSigner, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: estimateBlockhash.blockhash as Blockhash, lastValidBlockHeight: 0n },
        tx
      ),
    (tx) => updateOrAppendSetComputeUnitPriceInstruction(CONFIG.computeUnitPrice, tx),
    (tx) => updateOrAppendSetComputeUnitLimitInstruction(CONFIG.computeUnitLimit, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  );

  const signedEstimateTx = await partiallySignTransactionMessageWithSigners(estimateTx);
  const estimateWire = getBase64EncodedWireTransaction(signedEstimateTx);

  const paymentInfo = await kora.getPaymentInstruction({
    transaction: estimateWire,
    fee_token: USDC_MINT,
    source_wallet: buyer.address,
  });
  console.log("  Kora fee (USDC token units):", paymentInfo.payment_amount.toString());

  console.log("\n[5/6] Building final transaction with payment");
  const finalBlockhash = await kora.getBlockhash();

  const finalTx = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(noopSigner, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: finalBlockhash.blockhash as Blockhash, lastValidBlockHeight: 0n },
        tx
      ),
    (tx) => updateOrAppendSetComputeUnitPriceInstruction(CONFIG.computeUnitPrice, tx),
    (tx) => updateOrAppendSetComputeUnitLimitInstruction(CONFIG.computeUnitLimit, tx),
    (tx) =>
      appendTransactionMessageInstructions(
        [...instructions, paymentInfo.payment_instruction],
        tx
      )
  );

  const partiallySignedTx = await partiallySignTransactionMessageWithSigners(finalTx);
  const userSignedTx = await partiallySignTransaction([buyer.keyPair], partiallySignedTx);
  const finalWire = getBase64EncodedWireTransaction(userSignedTx);
  console.log("  Transaction built and signed by buyer");

  return { transaction: finalWire, signerAddress: signer_address, kora };
}
