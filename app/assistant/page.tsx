import type { Metadata } from "next";

import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "AI assistant" };

export default function Page() {
  return <ComingSoon title="AI assistant" phase={6} description="Ask questions about air quality. Every answer is grounded in live data with cited timestamps. Requires a Gemini API key." />;
}
