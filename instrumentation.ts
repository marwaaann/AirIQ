/**
 * Runs once when the server starts: validates the environment (lib/env.ts) and
 * logs which optional features are on. Values are never logged.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { envSummary, getEnvReport } = await import("@/lib/env");
  const report = getEnvReport();
  console.info(`[airiq] ${envSummary(report)}`);
  for (const w of report.warnings) console.warn(`[airiq] ${w}`);
}
