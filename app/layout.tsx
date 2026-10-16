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

// Applies the saved theme before first paint to avoid a light flash.
const THEME_INIT = "try{var t=localStorage.getItem('scrivia:theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;}catch(e){}";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
