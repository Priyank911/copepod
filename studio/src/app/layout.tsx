import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Copepod",
  description:
    "Copepod ingests your repository's decision history into a knowledge graph and makes it retrievable through a chat studio, MCP tools for AI agents, and a VS Code sidebar.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
