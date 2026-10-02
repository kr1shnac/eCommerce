import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function RiderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin' && profile?.role !== 'delivery') {
    redirect('/login');
  }

  return <div className="p-4">Rider (mobile-friendly)</div>;
}