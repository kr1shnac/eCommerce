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

  // This panel is the optional desk tool for bulk catalogue work. Orders and
  // deliveries live in the mobile app (the owner's board and the rider screen),
  // not here — see ROADMAP §2.
  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/categories', label: 'Categories' },
    { href: '/products', label: 'Products' },
    { href: '/settings', label: 'Settings' },
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-gray-200 p-4 space-y-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="block px-2 py-1 rounded hover:bg-gray-100">
            {l.label}
          </Link>
        ))}
        <p className="pt-4 text-xs text-gray-500">
          Orders and deliveries are in the mobile app.
        </p>
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  );
}