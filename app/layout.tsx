import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scrivia AI — Spazio alle tue idee",
  description: "Il tuo editor di scrittura con suggerimenti intelligenti in tempo reale.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className="antialiased">{children}</body>
    </html>
  );
}
