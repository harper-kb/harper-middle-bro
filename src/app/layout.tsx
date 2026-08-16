import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Cormorant_Garamond, Source_Sans_3, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import { AuthenticatedDeskWidgets } from "@/components/AuthenticatedDeskWidgets";
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
    "Step Bro — commercial lines service CRM. Task-grain desk, portal and email routing, underwriter communications, automatic approval at or below $500.",
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
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){var t;try{t=localStorage.getItem("step-bro-theme")}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t})();`,
          }}
        />
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "var(--accent)",
              colorPrimaryForeground: "var(--accent-contrast)",
              colorNeutral: "var(--foreground)",
              colorForeground: "var(--foreground)",
              colorMuted: "var(--surface-subtle)",
              colorMutedForeground: "var(--muted)",
              colorBackground: "var(--surface-raised)",
              colorInput: "var(--surface)",
              colorInputForeground: "var(--foreground)",
              colorDanger: "var(--danger)",
              colorSuccess: "var(--success)",
              colorWarning: "var(--warning)",
              borderRadius: "0.75rem",
            },
          }}
        >
          <RedAlertBanner />
          {children}
          <AuthenticatedDeskWidgets />
        </ClerkProvider>
      </body>
    </html>
  );
}