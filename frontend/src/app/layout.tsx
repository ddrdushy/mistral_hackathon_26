import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://hireops.symprio.com";
const SITE_NAME = "HireOps AI";
const SITE_DESCRIPTION =
  "Multi-tenant AI recruiting OS. Auto-classify applications, score resumes, run AI Q&A and voice interviews, and surface the best candidates — all from a single dashboard.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — From inbox to hired, on autopilot`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "AI recruiting",
    "applicant tracking system",
    "resume scoring",
    "AI interview",
    "Mistral AI",
    "ATS",
    "HR automation",
  ],
  authors: [{ name: "Symprio" }],
  creator: "Symprio",
  publisher: "Symprio",
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — From inbox to hired, on autopilot`,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — From inbox to hired, on autopilot`,
    description: SITE_DESCRIPTION,
    creator: "@symprio",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${inter.className} antialiased`}>
        {children}
      </body>
    </html>
  );
}
