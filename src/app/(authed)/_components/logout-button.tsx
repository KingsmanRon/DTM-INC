"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  async function onClick() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <button onClick={onClick} className="text-text-secondary hover:text-accent-teal">
      Sign out
    </button>
  );
}
