import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import VisitTracker from "./components/VisitTracker";
import { Analytics } from "@vercel/analytics/next";

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
  title: {
    default: "Cerebro",
    template: "%s | Cerebro",
  },
  description:
    "Cerebro builds operational systems for fitness operators, finance teams, and founder-led service businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${syne.variable} antialiased`}>
      <body className="min-h-screen bg-white text-black">
        <VisitTracker />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
