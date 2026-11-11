/**
 * The one place AirIQ imports Zod from.
 *
 * `jitless`: Zod 4 probes for `new Function` support the first time it parses
 * an object. The probe is caught, but under AirIQ's Content-Security-Policy
 * (no 'unsafe-eval') the browser still reports it as a CSP violation. Jitless
 * mode skips the probe; validation results are identical.
 *
 * Pure module (no "@/" imports) so `node --test` can load it.
 */
import { z } from "zod";

z.config({ jitless: true });

export { z };
