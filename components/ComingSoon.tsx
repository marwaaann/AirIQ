import Link from "next/link";

/** Honest placeholder for features scheduled in a later build phase. */
export function ComingSoon({ title, phase, description }: { title: string; phase: number; description: string }) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 py-20 text-center">
      <span className="rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted">
        Coming in a later phase (Phase {phase})
      </span>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted">{description}</p>
      <Link href="/" className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2">
        Back to the dashboard
      </Link>
    </section>
  );
}
