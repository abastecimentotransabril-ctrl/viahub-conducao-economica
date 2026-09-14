import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ViaHub Condução Econômica",
  description: "Sistema de análise e premiação de condução econômica",
  viewport: "width=device-width, initial-scale=1",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
