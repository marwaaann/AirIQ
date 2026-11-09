import type { Metadata } from "next";

import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Compare cities" };

export default function Page() {
  return <ComingSoon title="Compare cities" phase={7} description="Compare 2 to 4 cities side by side, with an overlay chart of their AQI over time." />;
}
