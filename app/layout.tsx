import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AlertRuntime } from "@/components/alerts/AlertRuntime";
import { ConnectivityStatus } from "@/components/pwa/ConnectivityStatus";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { SiteHeader } from "@/components/SiteHeader";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Absolute base for Open Graph image URLs. Set SITE_URL in production (optional).
  metadataBase: new URL(process.env.SITE_URL?.trim() || "http://localhost:3000"),
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
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
          {children}
        </main>
        <footer className="site-footer mx-auto w-full max-w-6xl px-4 pb-10 text-xs text-muted sm:px-6">
          Data: Open-Meteo Air Quality (CAMS), Open-Meteo Weather and Open-Meteo Geocoding. AQI categories per US EPA and EEA. Model data, not
          medical advice.
        </footer>
        <AlertRuntime />
        <ConnectivityStatus />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
