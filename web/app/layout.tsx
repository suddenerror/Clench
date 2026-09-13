import type { ReactNode } from "react";
import { Inter_Tight } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight" });

export const metadata = {
  title: "CLENCH",
  description: "Hold longer, earn more. Win the ticker, keep it forever."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body className="font-sans bg-graphite text-ink min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
