import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PrivyAppProvider } from "@/components/providers/privy-provider";
import "./globals.css";

const siteOrigin =
  process.env.NEXT_PUBLIC_WEB_ORIGIN ||
  process.env.NEXT_PUBLIC_WEB_ORIGIN_BASE_MAINNET ||
  process.env.NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_MAINNET ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
const metadataBase = new URL(siteOrigin);

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase,
  title: "InfoFi",
  applicationName: "InfoFi",
  description: "On-chain marketplace for paywalled knowledge digests and Q&A.",
  icons: {
    icon: [
      { url: "/lock-open.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    shortcut: ["/favicon.ico"],
  },
  keywords: [
    "InfoFi",
    "knowledge marketplace",
    "on-chain consulting",
    "agent marketplace",
    "paywalled knowledge",
    "Base mainnet",
  ],
  openGraph: {
    title: "InfoFi",
    description: "On-chain marketplace for paywalled knowledge digests and Q&A.",
    url: "/",
    siteName: "InfoFi",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "InfoFi",
    description: "On-chain marketplace for paywalled knowledge digests and Q&A.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeScript = `
    try {
      const stored = localStorage.getItem("infofi-theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const theme = stored || (prefersDark ? "dark" : "light");
      if (theme === "dark") document.documentElement.classList.add("dark");
    } catch {}
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PrivyAppProvider>{children}</PrivyAppProvider>
      </body>
    </html>
  );
}
