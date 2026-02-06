import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { MIN_PASSWORD_LENGTH, mapPasswordUpdateError, validateNewPassword } from '@/lib/passwordPolicy';
import { updatePassword } from '@/lib/supabaseAuth';

interface ChangePasswordCardProps {
  compact?: boolean;
}

export function ChangePasswordCard({ compact = false }: ChangePasswordCardProps) {
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const { refreshUserSession } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateNewPassword(form.password, form.confirm);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }
    setLoading(true);
    try {
      const result = await updatePassword(form.password);
      if (!result.ok) {
        const mapped = mapPasswordUpdateError(result.error);
        toast.error(mapped.title, { description: mapped.description });
        return;
      }
      await refreshUserSession();
      toast.success('Senha atualizada com sucesso!');
      setForm({ password: '', confirm: '' });
    } catch (error) {
      console.error('Error updating password:', error);
      const mapped = mapPasswordUpdateError(error);
      toast.error(mapped.title, { description: mapped.description });
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
            <input type="text" name="username" autoComplete="username" hidden readOnly />
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
            <p className="text-xs text-muted-foreground">
              Use pelo menos {MIN_PASSWORD_LENGTH} caracteres, com maiúscula, minúscula, número e símbolo.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Confirmar senha</Label>
            <Input
              type="password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              placeholder="••••••"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              minLength={MIN_PASSWORD_LENGTH}
              required
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
