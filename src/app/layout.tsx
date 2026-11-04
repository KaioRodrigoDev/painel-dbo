import type { Metadata } from "next";
import { Inter, Orbitron, Roboto_Mono, Space_Grotesk } from "next/font/google";

import "./globals.css";

// Inter no corpo (legível nas tabelas densas do painel), Space Grotesk nos títulos,
// Orbitron só na marca MDBO e Roboto Mono nos valores técnicos (IDs, caminhos, hex).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
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
  title: "MDBO Admin",
  description: "Painel administrativo do servidor MDBO",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${spaceGrotesk.variable} ${orbitron.variable} ${robotoMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
