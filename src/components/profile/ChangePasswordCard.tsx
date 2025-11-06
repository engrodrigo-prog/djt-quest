import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface ChangePasswordCardProps {
  compact?: boolean;
}

export function ChangePasswordCard({ compact = false }: ChangePasswordCardProps) {
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const { refreshUserSession } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.password || form.password.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres');
      return;
    }
    if (form.password === '123456') {
      toast.error('Por segurança, não use a senha padrão (123456)');
      return;
    }
    if (form.password !== form.confirm) {
      toast.error('As senhas não conferem');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: form.password });
      if (error) {
        if (
          // Mensagens comuns quando a senha nova é igual à atual
          (typeof error.message === 'string' && (
            error.message.includes('same_password') ||
            error.message.includes('should be different') ||
            error.message.toLowerCase().includes('same as the old password')
          ))
        ) {
          toast.error('A nova senha deve ser diferente da senha atual');
          return;
        }
        throw error;
      }
      await refreshUserSession();
      toast.success('Senha atualizada com sucesso!');
      setForm({ password: '', confirm: '' });
    } catch (error) {
      console.error('Error updating password:', error);
      toast.error('Não foi possível atualizar a senha');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      {!compact && (
        <CardHeader>
          <CardTitle>Alterar Senha</CardTitle>
          <CardDescription>Defina uma nova senha para a sua conta.</CardDescription>
        </CardHeader>
      )}
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Nova senha</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••"
            />
          </div>
          <div className="space-y-2">
            <Label>Confirmar senha</Label>
            <Input
              type="password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              placeholder="••••••"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Atualizando...' : 'Salvar nova senha'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
