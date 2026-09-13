import type { ReactNode } from "react";

export const metadata = {
  title: "CLENCH",
  description: "Hold longer, earn more."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
