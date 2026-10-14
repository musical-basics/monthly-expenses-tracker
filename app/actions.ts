"use server";

import { revalidatePath } from "next/cache";
import {
  updateSubscription,
  listTransactionsForMerchant,
  type SubscriptionUpdate,
} from "@/lib/queries";
import { runSync } from "@/lib/sync";
import { applySeed } from "@/lib/seed";

function revalidatePages() {
  revalidatePath("/");
  revalidatePath("/review");
}

export async function updateSubscriptionAction(id: number, patch: SubscriptionUpdate) {
  const updated = updateSubscription(id, patch);
  revalidatePages();
  return updated;
}

export async function getMerchantTransactionsAction(merchantKey: string) {
  return listTransactionsForMerchant(merchantKey, 200);
}

export async function syncAction() {
  const r = await runSync();
  revalidatePages();
  return r;
}

export async function seedAction() {
  const r = applySeed();
  revalidatePages();
  return r;
}
