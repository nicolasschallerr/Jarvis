"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/crm/notifications";
import { createClient } from "@/lib/supabase/server";

export async function markNoticesRead(): Promise<void> {
  const profile = await getCurrentProfile();
  await markAllNotificationsRead({ userClient: await createClient(), userId: profile.id });
  revalidatePath("/inicio");
  revalidatePath("/avisos");
}

export async function markNoticeRead(id: string): Promise<void> {
  const profile = await getCurrentProfile();
  await markNotificationRead({ userClient: await createClient(), userId: profile.id, id });
  revalidatePath("/inicio");
  revalidatePath("/avisos");
}
