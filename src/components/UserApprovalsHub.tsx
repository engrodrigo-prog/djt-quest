import { PendingApprovals } from '@/components/PendingApprovals'
import { PendingRegistrationsManager } from '@/components/PendingRegistrationsManager'
import { PasswordResetManager } from '@/components/PasswordResetManager'
import { UserManagement } from '@/components/UserManagement'
import { TipDialogButton } from '@/components/TipDialogButton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function UserApprovalsHub() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-3xl font-bold text-blue-50 mb-1">Gerenciar Usuários</h2>
          <TipDialogButton tipId="studio-user-approvals" ariaLabel="Entenda o hub de Gerenciar Usuários" className="inline-flex items-center justify-center rounded-full border border-white/20 bg-black/20 p-1 text-blue-100/80 hover:bg-black/30 hover:text-blue-50" />
        </div>
        <p className="text-blue-100/80">Cadastros, aprovações, resets e gestão completa</p>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full grid-cols-3 lg:w-[720px]">
          <TabsTrigger value="pending">Pendências</TabsTrigger>
          <TabsTrigger value="password-resets">Reset de Senha</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="min-h-[300px]">
              <PendingRegistrationsManager />
            </div>
            <div className="min-h-[300px]">
              <PendingApprovals />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="password-resets">
          <PasswordResetManager embedded />
        </TabsContent>

        <TabsContent value="users">
          <UserManagement />
        </TabsContent>
      </Tabs>
    </div>
  )
}
