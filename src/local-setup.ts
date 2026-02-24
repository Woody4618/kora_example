/**
 * Local test environment setup for the Kora gasless purchase example.
 *
 * This script:
 * 1. Generates keypairs (Kora signer, buyer, store authority, USDC mint)
 * 2. Airdrops SOL to the Kora signer and store authority
 * 3. Creates a local test USDC mint
 * 4. Mints USDC to the buyer
 * 5. Initializes the let-me-buy store with a USDC product
 * 6. Updates kora.toml and .env with the generated values
 *
 * Prerequisites: solana-test-validator running on localhost:8899
 */

import {
  airdropFactory,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  lamports,
  sendAndConfirmTransactionFactory,
  pipe,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  getBase58Decoder,
  getBase58Encoder,
  address,
  AccountRole,
  getProgramDerivedAddress,
  type KeyPairSigner,
  type Instruction,
} from "@solana/kit";
import {
  getCreateAccountInstruction,
} from "@solana-program/system";
import {
  getInitializeMintInstruction,
  getMintSize,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import { writeFile, readFile } from "fs/promises";
import path from "path";

const PROGRAM_ID = address("BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya");
const LAMPORTS_PER_SOL = 1_000_000_000n;
const USDC_DECIMALS = 6;
const STORE_NAME = "kora-test-store";
const PRODUCT_NAME = "coffee";
const PRODUCT_PRICE = 2_000_000; // 2 USDC

const rpc = createSolanaRpc("http://127.0.0.1:8899");
const rpcSubscriptions = createSolanaRpcSubscriptions("ws://127.0.0.1:8900");
const airdrop = airdropFactory({ rpc, rpcSubscriptions });

async function generateExportableKeypair(): Promise<{
  signer: KeyPairSigner;
  secretKeyB58: string;
}> {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);

  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
  );
  const rawPrivateKey = pkcs8.slice(-32);

  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey)
  );

  const solanaSecretKey = new Uint8Array(64);
  solanaSecretKey.set(rawPrivateKey, 0);
  solanaSecretKey.set(publicKeyBytes, 32);

  const secretKeyB58 = getBase58Decoder().decode(solanaSecretKey);
  const signer = await createKeyPairSignerFromBytes(
    getBase58Encoder().encode(secretKeyB58)
  );

  return { signer, secretKeyB58 };
}

async function sendIxs(
  payer: KeyPairSigner,
  instructions: Instruction[],
  label: string
) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m)
  );
  const signed = await signTransactionMessageWithSigners(tx);
  const sig = getSignatureFromTransaction(signed);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
    commitment: "confirmed",
  });
  console.log(`  ${label}: ${sig}`);
  return sig;
}

function encodeBorshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const buf = new Uint8Array(4 + bytes.length);
  new DataView(buf.buffer).setUint32(0, bytes.length, true);
  buf.set(bytes, 4);
  return buf;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { result.set(a, off); off += a.length; }
  return result;
}

function encodeU64LE(value: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(value), true);
  return buf;
}

async function main() {
  console.log("\n=== Local Setup for Kora Gasless Purchase ===\n");

  // 1. Generate keypairs (extractable so we can write them to .env)
  console.log("[1/6] Generating keypairs...");
  const kora = await generateExportableKeypair();
  const buyerKp = await generateExportableKeypair();
  const storeAuth = await generateExportableKeypair();
  const usdcKp = await generateExportableKeypair();

  const koraSigner = kora.signer;
  const buyer = buyerKp.signer;
  const storeAuthority = storeAuth.signer;
  const usdcMint = usdcKp.signer;

  console.log(`  Kora signer:    ${koraSigner.address}`);
  console.log(`  Buyer:          ${buyer.address}`);
  console.log(`  Store authority: ${storeAuthority.address}`);
  console.log(`  USDC mint:      ${usdcMint.address}`);

  // 2. Airdrop SOL
  console.log("\n[2/6] Airdropping SOL...");
  await airdrop({
    commitment: "confirmed",
    lamports: lamports(2n * LAMPORTS_PER_SOL),
    recipientAddress: koraSigner.address,
  });
  console.log(`  Kora signer: 2 SOL`);

  await airdrop({
    commitment: "confirmed",
    lamports: lamports(LAMPORTS_PER_SOL),
    recipientAddress: storeAuthority.address,
  });
  console.log(`  Store authority: 1 SOL`);

  await airdrop({
    commitment: "confirmed",
    lamports: lamports(LAMPORTS_PER_SOL / 10n),
    recipientAddress: buyer.address,
  });
  console.log(`  Buyer: 0.1 SOL (only for store init, not needed for gasless tx)`);

  // 3. Create USDC mint
  console.log("\n[3/6] Creating local USDC mint...");
  const mintSpace = BigInt(getMintSize());
  const mintRent = await rpc.getMinimumBalanceForRentExemption(mintSpace).send();

  await sendIxs(koraSigner, [
    getCreateAccountInstruction({
      payer: koraSigner,
      newAccount: usdcMint,
      lamports: mintRent,
      space: mintSpace,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMintInstruction({
      mint: usdcMint.address,
      decimals: USDC_DECIMALS,
      mintAuthority: koraSigner.address,
    }),
  ], "USDC mint created");

  // 4. Create ATAs and mint USDC to buyer and kora signer
  console.log("\n[4/6] Minting USDC to buyer and Kora signer...");

  const [buyerAta] = await findAssociatedTokenPda({
    owner: buyer.address,
    mint: usdcMint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [koraAta] = await findAssociatedTokenPda({
    owner: koraSigner.address,
    mint: usdcMint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  await sendIxs(koraSigner, [
    getCreateAssociatedTokenIdempotentInstruction({
      mint: usdcMint.address,
      payer: koraSigner,
      owner: buyer.address,
      ata: buyerAta,
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      mint: usdcMint.address,
      payer: koraSigner,
      owner: koraSigner.address,
      ata: koraAta,
    }),
    getMintToInstruction({
      mint: usdcMint.address,
      token: buyerAta,
      amount: BigInt(100_000_000), // 100 USDC
      mintAuthority: koraSigner,
    }),
    getMintToInstruction({
      mint: usdcMint.address,
      token: koraAta,
      amount: BigInt(100_000_000), // 100 USDC
      mintAuthority: koraSigner,
    }),
  ], "ATAs created + 100 USDC minted to buyer & Kora signer");

  // 5. Initialize the let-me-buy store and add a product
  console.log("\n[5/6] Initializing let-me-buy store...");

  const [receiptsPda] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      new TextEncoder().encode("receipts"),
      new TextEncoder().encode(STORE_NAME),
    ],
  });

  const initDiscriminator = new Uint8Array([175, 175, 109, 31, 13, 152, 155, 237]);
  const initData = concatBytes(initDiscriminator, encodeBorshString(STORE_NAME));

  const initIx: Instruction = {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: receiptsPda, role: AccountRole.WRITABLE },
      { address: storeAuthority.address, role: AccountRole.WRITABLE_SIGNER },
      { address: address("11111111111111111111111111111111"), role: AccountRole.READONLY },
    ],
    data: initData,
  };

  await sendIxs(storeAuthority, [initIx], "Store initialized");

  // Add product
  const addProductDiscriminator = new Uint8Array([0, 219, 137, 36, 105, 180, 164, 93]);
  const addProductData = concatBytes(
    addProductDiscriminator,
    encodeBorshString(STORE_NAME),
    encodeBorshString(PRODUCT_NAME),
    encodeU64LE(PRODUCT_PRICE)
  );

  const addProductIx: Instruction = {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: receiptsPda, role: AccountRole.WRITABLE },
      { address: storeAuthority.address, role: AccountRole.WRITABLE_SIGNER },
      { address: usdcMint.address, role: AccountRole.READONLY },
      { address: address("11111111111111111111111111111111"), role: AccountRole.READONLY },
    ],
    data: addProductData,
  };

  await sendIxs(storeAuthority, [addProductIx], `Product "${PRODUCT_NAME}" added (${PRODUCT_PRICE / 10 ** USDC_DECIMALS} USDC)`);

  // 6. Write config files
  console.log("\n[6/6] Writing configuration files...");

  const koraSecretKey = kora.secretKeyB58;
  const buyerSecretKey = buyerKp.secretKeyB58;

  // Update .env
  const envContent = `# Auto-generated by local-setup.ts
KORA_RPC_URL=http://localhost:8080/
SOLANA_RPC_URL=http://127.0.0.1:8899
SOLANA_WS_URL=ws://127.0.0.1:8900

# Buyer keypair (address: ${buyer.address})
BUYER_KEYPAIR=${buyerSecretKey}

# Store configuration
STORE_NAME=${STORE_NAME}
PRODUCT_NAME=${PRODUCT_NAME}
TABLE_NUMBER=1

# Store authority (address: ${storeAuthority.address})
STORE_AUTHORITY=${storeAuthority.address}

# Local test USDC mint
USDC_MINT=${usdcMint.address}
`;
  await writeFile(path.join(process.cwd(), ".env"), envContent);
  console.log("  .env written");

  // Update server/kora.toml with actual USDC mint
  const koraTomlPath = path.join(process.cwd(), "server", "kora.toml");
  let koraToml = await readFile(koraTomlPath, "utf-8");
  koraToml = koraToml.replace(/PLACEHOLDER_USDC_MINT/g, usdcMint.address);
  await writeFile(koraTomlPath, koraToml);
  console.log("  server/kora.toml updated with USDC mint");

  // Print the Kora signer key for export
  console.log("\n=== Setup Complete ===\n");
  console.log("Next steps:");
  console.log(`  1. Export the Kora signer key:`);
  console.log(`     export KORA_PRIVATE_KEY="${koraSecretKey}"`);
  console.log(`  2. Start the Kora server:`);
  console.log(`     cd server && kora rpc start --signers-config signers.toml`);
  console.log(`  3. Run the purchase:`);
  console.log(`     pnpm run purchase`);

  // Also write it to a temp file the shell script can source
  await writeFile(
    path.join(process.cwd(), ".kora-signer-key"),
    koraSecretKey
  );
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
