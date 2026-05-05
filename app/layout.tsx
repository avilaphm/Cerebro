import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const fraunces = localFont({
  src: "./fonts/fraunces-variable.woff2",
  variable: "--font-fraunces",
  display: "swap",
  weight: "100 900",
});

const syne = localFont({
  src: "./fonts/syne-variable.woff2",
  variable: "--font-syne",
  display: "swap",
  weight: "400 700",
});

export const metadata: Metadata = {
  title: "Cerebro. Bespoke systems for small businesses.",
  description:
    "Cerebro builds bespoke systems that handle the busywork behind small businesses, so owners can do the work that actually grows them.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${syne.variable} antialiased`}>
      <body className="min-h-screen bg-white text-black">{children}</body>
    </html>
  );
}
