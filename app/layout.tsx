import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scrivia — Argument writing",
  description: "Scrivia — Argument writing: dalla tesi agli argomenti, con suggerimenti AI e progetti LaTeX.",
  manifest: "/manifest.webmanifest",
  applicationName: "Scrivia",
  appleWebApp: { capable: true, title: "Scrivia", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = { themeColor: "#345847", viewportFit: "cover", interactiveWidget: "resizes-content" };

// Applies the saved theme before first paint to avoid a light flash.
const THEME_INIT = "try{var t=localStorage.getItem('scrivia:theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;}catch(e){}"
  // Keeps the install prompt if the browser offers it before the app has loaded.
  + "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__scriviaInstall=e;});";

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
