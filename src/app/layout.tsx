import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Cormorant_Garamond, Source_Sans_3, IBM_Plex_Mono } from "next/font/google";
import { MiddleBroBot } from "@/components/MiddleBroBot";
import { OperatorInbox } from "@/components/OperatorInbox";
import { RedAlertBanner } from "@/components/RedAlertBanner";
import { PRODUCT_NAME } from "@/lib/brand";
import { localAuthEnabled } from "@/lib/local-auth";
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
    "Step Bro — commercial lines service CRM. Task-grain desk, portal and email routing, underwriter communications, automatic approval at or below $500.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shell = (
    <>
      <RedAlertBanner />
      {children}
      <OperatorInbox />
      <MiddleBroBot />
    </>
  );

  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full`}
    >
      <body className="min-h-full antialiased">
        {/* Mounting the provider boots clerk-js, which navigates away to Clerk's
            Frontend API. In local operator mode there may be no instance to
            navigate to, so leave it out entirely. */}
        {localAuthEnabled() ? (
          shell
        ) : (
          <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
            {shell}
          </ClerkProvider>
        )}
      </body>
    </html>
  );
}