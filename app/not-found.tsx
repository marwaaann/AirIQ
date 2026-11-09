import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="text-muted">
        That link doesn’t match a page or a valid city. City links look like <code className="font-mono">/city/delhi-28.652-77.231</code>.
      </p>
      <Link href="/" className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2">
        Search for a city
      </Link>
    </section>
  );
}
