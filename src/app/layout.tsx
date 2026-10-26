import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = localFont({
  src: "./fonts/inter.ttf",
  weight: "400 700",
  variable: "--font-sans",
  display: "swap",
});

const display = localFont({
  src: "./fonts/space-grotesk.ttf",
  weight: "500 700",
  variable: "--font-display",
  display: "swap",
});

const mono = localFont({
  src: "./fonts/jetbrains-mono.ttf",
  weight: "400 500",
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RepoShield",
  description: "Scan GitHub repositories for supply-chain malware without cloning them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable} dark`} suppressHydrationWarning>
      <body className="min-h-screen bg-app font-sans text-bone antialiased">
        <Script id="theme" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem("reposhild-theme");var e=document.documentElement;if(t==="light"){e.classList.remove("dark");e.classList.add("light")}else{e.classList.add("dark");e.classList.remove("light")}}catch(err){}})()`}
        </Script>
        <div className="ambient" aria-hidden="true">
          <div className="ambient-blob ambient-blob-a" />
          <div className="ambient-blob ambient-blob-b" />
          <div className="ambient-blob ambient-blob-c" />
          <div className="ambient-grid" />
          <div className="ambient-noise" />
        </div>
        <div className="relative z-10">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
