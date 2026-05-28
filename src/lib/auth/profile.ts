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

export const PROFILE_LOAD_ERROR_MESSAGE =
  "Sign-in succeeded, but your staff profile could not be loaded. Please contact admin.";

export function sessionFromProfile(profile: AppProfileRow | null): Session | null {
  if (!profile || profile.status !== "active") return null;
  if (profile.role_name !== "doctor" && profile.role_name !== "staff" && profile.role_name !== "admin") return null;

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role_name,
  };
}
