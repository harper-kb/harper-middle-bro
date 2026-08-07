import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Cormorant_Garamond, Source_Sans_3, IBM_Plex_Mono } from "next/font/google";
import { MiddleBroBot } from "@/components/MiddleBroBot";
import { OperatorInbox } from "@/components/OperatorInbox";
import { RedAlertBanner } from "@/components/RedAlertBanner";
import { PRODUCT_NAME } from "@/lib/brand";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const body = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description:
    "Commercial lines sandbox — portal & email routing, UW desk, auto-approve ≤ $500",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full`}
    >
      <body className="min-h-full antialiased">
        <ClerkProvider>
          <RedAlertBanner />
          {children}
          <OperatorInbox />
          <MiddleBroBot />
        </ClerkProvider>
      </body>
    </html>
  );
}