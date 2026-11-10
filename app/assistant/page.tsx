import type { Metadata } from "next";

import { AssistantChat } from "@/components/assistant/AssistantChat";

export const metadata: Metadata = {
  title: "AI assistant",
  description: "Ask about air quality anywhere. Answers are grounded in live Open-Meteo (CAMS) data fetched for each question.",
};

export default function AssistantPage() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-9rem)] min-h-[32rem] max-w-3xl flex-col gap-3 py-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ask AirIQ</h1>
        <p className="text-sm text-muted">
          An AI assistant that answers only from data it fetches with AirIQ&rsquo;s tools (current AQI, history, forecast, comparisons, health advice and
          safe-time windows). Name a city in your question.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <AssistantChat chatId="page" />
      </div>
    </div>
  );
}
