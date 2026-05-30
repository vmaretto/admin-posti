import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import PeriodoPicker from "@/components/PeriodoPicker";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Admin pOsti - Riconciliazione Fatture",
  description: "Gestione fatture e transazioni pOsti SRL",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className="dark:bg-gray-900">
      <body className={`${inter.className} bg-gray-50 dark:bg-gray-900 dark:text-gray-100`}>
        <nav className="bg-indigo-600 text-white shadow-lg">
          <div className="max-w-7xl mx-auto px-3 sm:px-4">
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-0 sm:min-h-16">
              <Link href="/" className="font-bold text-xl leading-tight whitespace-nowrap">
                pOsti Admin
              </Link>
              <div className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:justify-end sm:gap-1 sm:overflow-visible sm:px-0 sm:pb-0">
                <Link href="/" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Dashboard
                </Link>
                <Link href="/fatture" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Fatture
                </Link>
                <Link href="/fatture-estere" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Estere
                </Link>
                <Link href="/transazioni" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Transazioni
                </Link>
                <Link href="/riconcilia" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Riconcilia
                </Link>
                <Link href="/analisi-2025" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Check 2025
                </Link>
                <Link href="/soggetti" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Soggetti
                </Link>
                <Link href="/import" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Import
                </Link>
                <Link href="/import/tabelle" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Tabelle import
                </Link>
                <Link href="/wizard" className="shrink-0 hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium bg-indigo-500/30">
                  Wizard
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <PeriodoPicker />
        <main className="max-w-7xl mx-auto px-3 py-5 sm:px-4 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
