import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "DTM Inc. — Patient Records",
  description: "Dr. Thomas Mtshali Inc. — Specialist Laparoscopic and General Surgeon. Internal staff system.",
  applicationName: "DTM Inc.",
  robots: { index: false, follow: false, nocache: true },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/favicon.svg", apple: "/icons/apple-touch-icon.png" },
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
    <html lang="en-ZA">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
