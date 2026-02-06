import { StudyLab } from "@/components/StudyLab";
import Navigation from "@/components/Navigation";
import { ThemedBackground } from "@/components/ThemedBackground";
import { useI18n } from "@/contexts/I18nContext";

export default function Study() {
  const { t } = useI18n();
  return (
    <div className="relative min-h-screen bg-transparent pb-[calc(7.5rem+env(safe-area-inset-bottom))] lg:pb-10 lg:pl-[var(--djt-nav-desktop-offset)]">
      <ThemedBackground theme="seguranca" />
      <main className="container relative mx-auto px-3 sm:px-4 lg:px-6 py-4 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-blue-50">{t("study.title")}</h1>
          <p className="text-sm text-blue-100/80">
            {t("study.subtitle")}
          </p>
        </div>
        <StudyLab />
      </main>
      <Navigation />
    </div>
  );
}
