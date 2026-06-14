export type AppRole = "doctor" | "staff" | "admin";

export type Session = {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
};

export type AppProfileRow = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  role_name: string | null;
};

export type AppProfileQueryRow = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  roles: { name: string | null } | { name: string | null }[] | null;
};

export type AppProfileFailureReason = "missing" | "inactive" | "missing_role" | "invalid_role";

export const APP_PROFILE_SELECT = "id, email, full_name, status, roles:role_id(name)";

export const APP_PROFILE_QUERY_DESCRIPTION = {
  table: "public.app_users",
  filter: "app_users.id = auth.users.id",
  roleJoin: "roles:role_id(name)",
} as const;

export const PROFILE_MISSING_ERROR_MESSAGE =
  "Sign-in succeeded, but no staff profile exists for this account. Please contact admin.";

export const PROFILE_INACTIVE_ERROR_MESSAGE =
  "Sign-in succeeded, but your staff profile is not active. Please contact admin.";

export const PROFILE_MISSING_ROLE_ERROR_MESSAGE =
  "Sign-in succeeded, but your staff profile does not have an assigned app role. Please contact admin.";

export const PROFILE_INVALID_ROLE_ERROR_MESSAGE =
  "Sign-in succeeded, but your staff profile has an invalid app role. Please contact admin.";

export const PROFILE_API_UNAVAILABLE_ERROR_MESSAGE =
  "Sign-in succeeded, but the staff profile service is unavailable or timed out. Please try again or contact admin.";

const VALID_APP_ROLES: ReadonlySet<string> = new Set(["doctor", "staff", "admin"]);

export function roleNameFromQueryRow(row: AppProfileQueryRow): string | null {
  const relation = Array.isArray(row.roles) ? row.roles[0] ?? null : row.roles;
  return relation?.name ?? null;
}

export function profileFromQueryRow(row: AppProfileQueryRow | null): AppProfileRow | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    status: row.status,
    role_name: roleNameFromQueryRow(row),
  };
}

export function getProfileFailureReason(profile: AppProfileRow | null): AppProfileFailureReason | null {
  if (!profile) return "missing";
  if (profile.status !== "active") return "inactive";
  if (!profile.role_name) return "missing_role";
  if (!VALID_APP_ROLES.has(profile.role_name)) return "invalid_role";
  return null;
}

export function profileFailureMessage(reason: AppProfileFailureReason): string {
  switch (reason) {
    case "missing":
      return PROFILE_MISSING_ERROR_MESSAGE;
    case "inactive":
      return PROFILE_INACTIVE_ERROR_MESSAGE;
    case "missing_role":
      return PROFILE_MISSING_ROLE_ERROR_MESSAGE;
    case "invalid_role":
      return PROFILE_INVALID_ROLE_ERROR_MESSAGE;
  }
}

export function sessionFromProfile(profile: AppProfileRow | null): Session | null {
  if (!profile || getProfileFailureReason(profile)) return null;

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role_name as AppRole,
  };
}

// API-layer MFA policy — the mirror of resolveMfa (FR-1) for Route Handlers.
// The page layout (resolveMfa) only protects browser NAVIGATION; a direct API
// caller bypasses it, so requireRole must re-assert step-up itself or MFA is
// cosmetic against a scripted client holding a password-only (AAL1) session.
//
//   * doctor + admin: must have reached AAL2 (passed the TOTP challenge).
//   * staff: MFA optional in v1 (same carve-out resolveMfa makes) — AAL1 is fine.
//
// Pure so it is unit-tested without server deps; the AAL value is fetched in
// session.ts and passed in.
export function apiMfaSatisfied(role: AppRole, currentLevel: string | null | undefined): boolean {
  if (role === "staff") return true;
  return currentLevel === "aal2";
}
