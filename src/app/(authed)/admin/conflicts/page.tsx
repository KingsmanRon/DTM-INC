import { requireRole } from "@/lib/auth/session";
import { OfflineConflictReview } from "@/components/OfflineConflictReview";

export default async function OfflineConflictsPage() {
  await requireRole(["admin", "staff"]);

  return (
    <div className="max-w-5xl mx-auto">
      <OfflineConflictReview />
    </div>
  );
}
