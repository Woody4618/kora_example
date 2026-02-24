import {
  address,
  Address,
  AccountRole,
  AccountMeta,
  getProgramDerivedAddress,
  type Instruction,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

export const LET_ME_BUY_PROGRAM_ID = address(
  "BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya"
);
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
export const ATA_PROGRAM = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

const MAKE_PURCHASE_DISCRIMINATOR = new Uint8Array([
  193, 62, 227, 136, 105, 212, 201, 20,
]);

function encodeBorshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const buffer = new Uint8Array(4 + bytes.length);
  new DataView(buffer.buffer).setUint32(0, bytes.length, true);
  buffer.set(bytes, 4);
  return buffer;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export async function getReceiptsPda(storeName: string) {
  return getProgramDerivedAddress({
    programAddress: LET_ME_BUY_PROGRAM_ID,
    seeds: [
      new TextEncoder().encode("receipts"),
      new TextEncoder().encode(storeName),
    ],
  });
}

export interface MakePurchaseParams {
  storeName: string;
  productName: string;
  tableNumber: number;
  buyer: Address;
  storeAuthority: Address;
  mint: Address;
}

/**
 * Builds the `make_purchase` instruction for the let-me-buy program.
 *
 * The buyer pays for the product in whatever token the store accepts.
 * When combined with Kora, the transaction fee is paid by Kora's fee payer
 * and the buyer reimburses Kora in USDC via a separate payment instruction.
 */
export async function getMakePurchaseInstruction(
  params: MakePurchaseParams
): Promise<Instruction> {
  const { storeName, productName, tableNumber, buyer, storeAuthority, mint } =
    params;

  const [receiptsPda] = await getReceiptsPda(storeName);

  const [senderTokenAccount] = await findAssociatedTokenPda({
    owner: buyer,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const [recipientTokenAccount] = await findAssociatedTokenPda({
    owner: storeAuthority,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const data = concatBytes(
    MAKE_PURCHASE_DISCRIMINATOR,
    encodeBorshString(storeName),
    encodeBorshString(productName),
    new Uint8Array([tableNumber])
  );

  const accounts: AccountMeta[] = [
    { address: receiptsPda, role: AccountRole.WRITABLE },
    { address: buyer, role: AccountRole.WRITABLE_SIGNER },
    { address: storeAuthority, role: AccountRole.WRITABLE },
    { address: mint, role: AccountRole.READONLY },
    { address: senderTokenAccount, role: AccountRole.WRITABLE },
    { address: recipientTokenAccount, role: AccountRole.WRITABLE },
    { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: ATA_PROGRAM, role: AccountRole.READONLY },
  ];

  return {
    programAddress: LET_ME_BUY_PROGRAM_ID,
    accounts,
    data,
  };
}
