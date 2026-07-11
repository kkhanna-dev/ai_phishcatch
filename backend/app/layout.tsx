import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PhishCatch — Phishing Detector",
  description:
    "Rule-based email phishing detection — no AI, no API costs, no external calls. Paste an email or scan Gmail with the Chrome extension for an instant risk score and breakdown.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%236366f1' d='M12 2 3 6v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V6l-9-4Z'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans antialiased">{children}</body>
    </html>
  );
}
