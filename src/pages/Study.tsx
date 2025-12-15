import { StudyLab } from "@/components/StudyLab";
import Navigation from "@/components/Navigation";
import { ThemedBackground } from "@/components/ThemedBackground";

export default function Study() {
  return (
    <div className="relative min-h-screen bg-transparent pb-32">
      <ThemedBackground theme="seguranca" />
      <main className="container relative mx-auto px-3 py-4 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-blue-50">Laboratório de Estudos</h1>
          <p className="text-sm text-blue-100/80">
            Envie materiais, catalogue para consulta e converse com a IA sobre os conteúdos para aprofundar seus conhecimentos.
          </p>
        </div>
        <StudyLab showOrgCatalog />
      </main>
      <Navigation />
    </div>
  );
}
