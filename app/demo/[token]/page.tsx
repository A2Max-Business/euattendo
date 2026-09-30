import type { Metadata } from "next";
import { DemoChat } from "./_components/DemoChat";

interface Props {
  params: Promise<{ token: string }>;
}

export const metadata: Metadata = {
  title: "Demonstração de Atendimento com IA — NB Pneus e Auto Center",
  description: "Ambiente de avaliação de qualidade conversacional com inteligência artificial.",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
};

export default async function DemoPage({ params }: Props) {
  const { token } = await params;
  return <DemoChat token={token} />;
}