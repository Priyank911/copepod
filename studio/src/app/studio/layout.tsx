import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Studio | Copepod",
  description: "Query your repository's institutional memory through a chat interface with source citations.",
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
