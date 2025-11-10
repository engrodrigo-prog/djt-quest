import { PendingApprovals } from '@/components/PendingApprovals'
import { PendingRegistrationsManager } from '@/components/PendingRegistrationsManager'
import { UserManagement } from '@/components/UserManagement'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function UserApprovalsHub() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-blue-50 mb-1">Cadastros & Aprovações</h2>
        <p className="text-blue-100/80">Pendências e gestão completa de usuários</p>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:w-[480px]">
          <TabsTrigger value="pending">Pendências</TabsTrigger>
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

        <TabsContent value="users">
          <UserManagement />
        </TabsContent>
      </Tabs>
    </div>
  )
}
