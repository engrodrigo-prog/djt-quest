import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Target, HelpCircle, MessageSquare, Crown } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'

export function ContentHub({ onOpen }: { onOpen: (id: 'campaigns' | 'campaigns-manage' | 'quiz' | 'quiz-manage' | 'forums' | 'forums-manage' | 'ai-quiz') => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-blue-50 mb-1">{t('contentHub.title')}</h2>
        <p className="text-blue-100/80">{t('contentHub.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-cyan-800/40 bg-white/5 hover:-translate-y-1 transition">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <CardTitle className="text-blue-50">{t('contentHub.campaigns.title')}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button
              onClick={() => {
                try { localStorage.setItem('campaign_form_type', 'individual'); } catch { /* noop */ }
                onOpen('campaigns');
              }}
              className="w-full"
            >
              {t('contentHub.campaigns.createIndividual')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                try { localStorage.setItem('campaign_form_type', 'team'); } catch { /* noop */ }
                onOpen('campaigns');
              }}
              className="w-full"
            >
              {t('contentHub.campaigns.createTeam')}
            </Button>
            <Button variant="outline" onClick={() => onOpen('campaigns-manage')} className="w-full">{t('contentHub.campaigns.manage')}</Button>
          </CardContent>
        </Card>

        <Card className="border-cyan-800/40 bg-white/5 hover:-translate-y-1 transition">
          <CardHeader>
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary" />
              <CardTitle className="text-blue-50">{t('contentHub.quizzes.title')}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => onOpen('quiz')} className="w-full">
              {t('contentHub.quizzes.create')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => onOpen('ai-quiz')}
              className="w-full inline-flex items-center gap-2"
            >
              <Crown className="h-4 w-4" />
              {t('contentHub.quizzes.milhaoAi')}
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpen('quiz-manage')}
              className="w-full"
            >
              {t('contentHub.quizzes.manage')}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-cyan-800/40 bg-white/5 hover:-translate-y-1 transition">
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <CardTitle className="text-blue-50">{t('contentHub.forums.title')}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => onOpen('forums')} className="w-full">{t('contentHub.forums.create')}</Button>
            <Button variant="outline" onClick={() => onOpen('forums-manage')} className="w-full">{t('contentHub.forums.manage')}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
