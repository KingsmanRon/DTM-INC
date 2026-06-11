"use client";

export function LogoutButton() {
  async function onClick() {
    // Server-side sign-out so the logout lands in the audit log (review P0#3).
    // The route clears the auth cookies on its response; the full-page
    // navigation guarantees the cleared cookies propagate to the next request
    // — router.push would race the cookie clear.
    try {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      /* even if the request fails, leave the page — middleware will bounce */
    }
    window.location.assign("/login");
  }
  return (
    <button onClick={onClick} className="text-text-secondary hover:text-accent-teal">
      Sign out
    </button>
  );
}
