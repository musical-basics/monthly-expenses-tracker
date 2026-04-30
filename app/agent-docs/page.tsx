export const dynamic = "force-static";

const sections: { title: string; body: string | string[] }[] = [
  {
    title: "Purpose",
    body: "Operational view for Commander to track Lionel's recurring charges. Pull from SimpleFIN, detect subscriptions, triage. This service tracks and advises only — actual cancellations happen out-of-band.",
  },
  {
    title: "Auth",
    body: 'Every /api/* call requires `Authorization: Bearer <AGENT_API_TOKEN>`. The token lives in the .env on the same machine as Commander. Without it the server returns 401.',
  },
  {
    title: "Conventions",
    body: [
      "Timestamps: epoch ms",
      "Amounts: cents (integer). Negative = debit. Divide by 100 for dollars.",
      "Statuses: active, review, needs_cancellation, canceled, hidden, unknown",
      "Cadences: weekly, monthly, quarterly, annual, irregular",
      "Confidences: high, medium, low",
    ],
  },
  {
    title: "Endpoints",
    body: [
      "POST /api/sync — pull SimpleFIN + re-detect. Body: { lookbackDays?: 1-730 }",
      "GET  /api/subscriptions[?status=...&include_hidden=true] — list",
      "GET  /api/subscriptions/:id — one + recent transactions",
      "PATCH /api/subscriptions/:id — { status?, priority?, owner?, notes?, cancellation_progress?, merchant_display? }",
      "GET  /api/subscriptions/upcoming?window_days=14 — predicted-next-charge in window",
      "GET  /api/subscriptions/review — anything needing attention",
      "POST /api/seed — re-apply Commander's seed list (Higgsfield, Ollama, zBackup, Teachable, BetterHelp, Verizon)",
      "GET  /api/docs — JSON schema of all endpoints",
    ],
  },
  {
    title: "Recommended Commander workflow",
    body: [
      "1. POST /api/sync (start of session)",
      "2. GET /api/subscriptions/review — what needs attention",
      "3. GET /api/subscriptions/upcoming?window_days=7 — this week's renewals",
      "4. PATCH with { status: 'canceled', cancellation_progress: '...' } as you work cancellations",
      "5. PATCH with { status: 'hidden' } for false positives",
    ],
  },
  {
    title: "Safety",
    body: [
      "Bearer token required on every endpoint",
      "SimpleFIN secret kept in env / data/.access_url (chmod 600), never logged",
      "Account numbers redacted with X's",
      "No financial actions taken — read-only against the bank",
    ],
  },
];

export default function AgentDocsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-10 text-neutral-200">
      <h1 className="text-3xl font-semibold mb-2">Agent Docs</h1>
      <p className="text-neutral-400 text-sm mb-8">
        For Commander. Machine-readable JSON at{" "}
        <code className="bg-neutral-900 px-1.5 py-0.5 rounded">/api/docs</code>.
      </p>
      {sections.map((s) => (
        <section key={s.title} className="mb-8">
          <h2 className="text-lg font-medium mb-2 text-neutral-100">{s.title}</h2>
          {Array.isArray(s.body) ? (
            <ul className="list-disc list-inside space-y-1 text-sm text-neutral-300">
              {s.body.map((line) => (
                <li key={line}>
                  <code className="text-neutral-100">{line}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-300">{s.body}</p>
          )}
        </section>
      ))}
    </main>
  );
}
