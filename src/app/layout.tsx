import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Outfit, IBM_Plex_Mono } from "next/font/google";
import { SwRegister } from "./sw-register";
import { IOSInstallBanner } from "@/components/IOSInstallBanner";
import { AndroidInstallButton } from "@/components/AndroidInstallButton";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-outfit",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "DTM Inc. — Patient Records",
  description: "Dr. Thomas Mtshali Inc. — Specialist Laparoscopic and General Surgeon. Internal staff system.",
  applicationName: "DTM Inc.",
  robots: { index: false, follow: false, nocache: true },
  // manifest is auto-generated from src/app/manifest.ts and served at /manifest.webmanifest.
  icons: {
    icon: [
      { url: "/icons/favicon.ico", sizes: "any" },
      { url: "/icons/favicon-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/favicon-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
  // iOS ignores the web manifest for home-screen pins, so these meta tags
  // are what give us standalone launch + the correct icon (not a screenshot)
  // + the right title under the icon.
  appleWebApp: {
    capable: true,
    title: "DTM Inc.",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#050A16",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className={`${outfit.variable} ${ibmPlexMono.variable}`}>
      <body>
        {children}
        <SwRegister />
        <IOSInstallBanner />
        <AndroidInstallButton />
      </body>
    </html>
  );
}
