"use server";

import { revalidatePath } from "next/cache";
import {
  updateSubscription,
  listTransactionsForMerchant,
  type SubscriptionUpdate,
} from "@/lib/queries";
import { runSync } from "@/lib/sync";
import { applySeed } from "@/lib/seed";

export async function updateSubscriptionAction(id: number, patch: SubscriptionUpdate) {
  const updated = updateSubscription(id, patch);
  revalidatePath("/");
  return updated;
}

export async function getMerchantTransactionsAction(merchantKey: string) {
  return listTransactionsForMerchant(merchantKey, 200);
}

export async function syncAction() {
  const r = await runSync();
  revalidatePath("/");
  return r;
}

export async function seedAction() {
  const r = applySeed();
  revalidatePath("/");
  return r;
}
