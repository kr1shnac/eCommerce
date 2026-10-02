import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function AdminAppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') redirect('/login');

  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/categories', label: 'Categories' },
    { href: '/products', label: 'Products' },
    { href: '/settings', label: 'Settings' },
    { href: '/orders', label: 'Orders' },
    { href: '/rider', label: 'Rider' },
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-gray-200 p-4 space-y-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="block px-2 py-1 rounded hover:bg-gray-100">
            {l.label}
          </Link>
        ))}
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  );
}