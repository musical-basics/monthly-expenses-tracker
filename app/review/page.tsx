import { listSubscriptions, lastSuccessfulSyncAt, withAccounts } from "@/lib/queries";
import { fmtDate, fmtRelative } from "@/lib/format";
import ReviewDashboard from "../components/ReviewDashboard";
import SyncButton from "../components/SyncButton";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  const subs = withAccounts(listSubscriptions());
  const syncedAt = lastSuccessfulSyncAt();

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <header className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <a href="/" className="text-xs text-neutral-500 hover:text-neutral-300">
            ← All subscriptions
          </a>
          <h1 className="text-3xl font-semibold tracking-tight mt-1">Review</h1>
          <p className="text-neutral-400 text-sm mt-1 max-w-2xl">
            Mark what you&apos;ve already canceled, and flag anything you need to double-check.
            Charge data as of{" "}
            <span className="text-neutral-200">
              {syncedAt ? `${fmtDate(syncedAt)} (${fmtRelative(syncedAt)})` : "never"}
            </span>
            .
          </p>
        </div>
        <SyncButton />
      </header>

      <ReviewDashboard subs={subs} syncedAt={syncedAt} />
    </main>
  );
}
