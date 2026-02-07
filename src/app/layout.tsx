import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";

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
    <html lang="it">
      <body className={`${inter.className} bg-gray-50`}>
        <nav className="bg-indigo-600 text-white shadow-lg">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <Link href="/" className="font-bold text-xl">
                pOsti Admin
              </Link>
              <div className="flex space-x-4">
                <Link href="/" className="hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Dashboard
                </Link>
                <Link href="/fatture" className="hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Fatture
                </Link>
                <Link href="/transazioni" className="hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Transazioni
                </Link>
                <Link href="/riconcilia" className="hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Riconcilia
                </Link>
                <Link href="/import" className="hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium">
                  Import
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
