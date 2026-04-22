"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";

export function LogoutButton() {
  async function onClick() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    // Full-page navigation guarantees the cleared cookies propagate to
    // the next server request — router.push would race the cookie clear.
    window.location.assign("/login");
  }
  return (
    <button onClick={onClick} className="text-text-secondary hover:text-accent-teal">
      Sign out
    </button>
  );
}
