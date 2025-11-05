import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function ChangePasswordCard() {
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.password || form.password.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres');
      return;
    }
    if (form.password !== form.confirm) {
      toast.error('As senhas não conferem');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: form.password });
      if (error) throw error;
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
      <CardHeader>
        <CardTitle>Alterar Senha</CardTitle>
        <CardDescription>Defina uma nova senha para a sua conta.</CardDescription>
      </CardHeader>
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
