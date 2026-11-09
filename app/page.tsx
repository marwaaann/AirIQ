export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-3xl font-bold">AirIQ</h1>
      <p className="mt-2 opacity-80">Real-time air quality intelligence. The dashboard is being built.</p>
      <ul className="mt-6 list-disc pl-6 font-mono text-sm">
        <li>
          <a className="underline" href="/api/geocode?q=Delhi">/api/geocode?q=Delhi</a>
        </li>
        <li>
          <a className="underline" href="/api/air?lat=28.61&amp;lon=77.21">/api/air?lat=28.61&amp;lon=77.21</a>
        </li>
      </ul>
    </main>
  );
}
