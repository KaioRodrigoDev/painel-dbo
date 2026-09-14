import type { Metadata } from "next";
import { Orbitron, Roboto, Roboto_Mono } from "next/font/google";

import "./globals.css";

// Mesmas fontes do site público (dboworld-new-site), para o painel seguir a
// mesma identidade visual. Roboto no corpo, Orbitron nos títulos, Roboto Mono
// nos valores técnicos (IDs, caminhos, hex) que o painel exibe bastante.
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-roboto",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["700", "900"],
  variable: "--font-orbitron",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-roboto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DBO World Admin",
  description: "Painel administrativo do servidor Dbo World",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${roboto.variable} ${orbitron.variable} ${robotoMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
