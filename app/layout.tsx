import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BCA Contact Finder",
  description:
    "Find portfolio managers, CIOs, and allocators at any asset manager, hedge fund, private equity firm, or family office.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-ink text-bwhite">{children}</body>
    </html>
  );
}
