import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscriptions Tracker",
  description: "SimpleFIN-powered subscriptions tracker for Lionel/Commander",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 min-h-screen">{children}</body>
    </html>
  );
}
