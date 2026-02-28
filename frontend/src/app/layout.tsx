import type { Metadata } from "next";
import { Inter } from "next/font/google";
import DashboardShell from "@/components/layout/DashboardShell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "HireOps AI",
  description: "Enterprise hiring operations platform powered by AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${inter.className} antialiased`}>
        <DashboardShell>{children}</DashboardShell>
      </body>
    </html>
  );
}
