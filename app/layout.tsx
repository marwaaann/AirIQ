import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import Link from "next/link";

import { AlertRuntime } from "@/components/alerts/AlertRuntime";
import { ConnectivityStatus } from "@/components/pwa/ConnectivityStatus";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { SiteHeader } from "@/components/SiteHeader";
import { getEnv } from "@/lib/env";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Absolute base for Open Graph image URLs. Set SITE_URL in production (optional).
  metadataBase: new URL(getEnv().siteUrl),
  applicationName: "AirIQ",
  title: { default: "AirIQ: Real-Time Air Quality Intelligence", template: "%s · AirIQ" },
  description: "Live AQI, pollution maps, history, forecasts, alerts and an AI assistant, built on open air-quality data.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e14" },
  ],
};

/**
 * Runs before first paint so the stored theme applies without a flash.
 * Stored value is JSON ("light" | "dark" | "system"); default follows the OS.
 */
const themeScript = `(function(){try{var d=document.documentElement,v="system",r=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(r)v=JSON.parse(r);var dark=v==="dark"||(v!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);d.setAttribute("data-theme",dark?"dark":"light");}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistMono.variable} min-h-dvh antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 outline-none sm:px-6">
          {children}
        </main>
        <footer className="site-footer mx-auto w-full max-w-6xl px-4 pb-24 text-xs text-muted sm:px-6">
          <p>
            Data:{" "}
            <a href="https://open-meteo.com/" className="underline underline-offset-2 hover:text-text">
              Open-Meteo
            </a>{" "}
            (CC BY 4.0), generated using Copernicus Atmosphere Monitoring Service information; ground stations from WAQI or OpenAQ when enabled; map tiles
            powered by Esri. AQI categories per US EPA and EEA. General information, not medical advice.{" "}
            <Link href="/about" className="font-medium underline underline-offset-2 hover:text-text">
              About, sources and methods
            </Link>
          </p>
        </footer>
        <AlertRuntime />
        <ConnectivityStatus />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
