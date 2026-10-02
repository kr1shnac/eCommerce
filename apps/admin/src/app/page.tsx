export default function AdminHomePage() {
  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        textAlign: 'center',
      }}>
      <div style={{ fontSize: 44 }}>🏪</div>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Kunigal Grocery — Shop Admin</h1>
      <p style={{ maxWidth: 460, opacity: 0.7, lineHeight: 1.6 }}>
        This panel is intentionally empty for now. Product management, order
        status updates and delivery settings will be built here, talking to the
        same Supabase database as the mobile app.
      </p>
      <p style={{ opacity: 0.5, fontSize: 14 }}>Next.js {process.env.NEXT_PUBLIC_APP_VERSION ?? '16'} · TypeScript</p>
    </main>
  );
}