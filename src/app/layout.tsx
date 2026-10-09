import type { Metadata } from "next";
import "./globals.css";
import "./brand.css";
export const metadata: Metadata = {
  title: "UpKeepHR · Recursos Humanos",
  description: "UpKeepHR: documentación y cumplimiento de Recursos Humanos.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
