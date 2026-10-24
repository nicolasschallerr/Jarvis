"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { markAllNotificationsRead } from "@/lib/crm/notifications";
import { createClient } from "@/lib/supabase/server";

export async function markNoticesRead(): Promise<void> {
  const profile = await getCurrentProfile();
  await markAllNotificationsRead({ userClient: await createClient(), userId: profile.id });
  revalidatePath("/");
}
