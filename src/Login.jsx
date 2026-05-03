import { supabase } from './supabase'

export default function Login() {
  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    })
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#eef2ff',
      fontFamily: 'DM Sans, sans-serif'
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '48px 40px',
        textAlign: 'center', border: '1px solid #e0e7ff',
        boxShadow: '0 4px 24px #4f46e510', width: 380
      }}>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 500, color: '#4f46e5', marginBottom: 8 }}>
          CROMÁTICA
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 32 }}>
          Sistema de presupuesto
        </div>
        <button onClick={handleGoogle} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, width: '100%', padding: '12px 20px',
          background: '#fff', border: '2px solid #e0e7ff',
          borderRadius: 10, fontSize: 14, fontWeight: 600,
          color: '#0f172a', cursor: 'pointer',
          transition: 'border-color 0.15s'
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#4f46e5'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#e0e7ff'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Entrar con Google
        </button>
      </div>
    </div>
  )
}
