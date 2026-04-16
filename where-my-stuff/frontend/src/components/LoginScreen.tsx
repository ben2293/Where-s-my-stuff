import { Package2, Lock, RefreshCw, Zap } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props { authError?: string | null; }

export default function LoginScreen({ authError }: Props) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">

        <div className="text-center mb-2">
          <div className="inline-flex items-center justify-center w-11 h-11 bg-secondary rounded-xl mb-3 border border-border">
            <Package2 className="w-5 h-5 text-foreground" strokeWidth={1.75} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Where's My Stuff?</h1>
          <p className="text-sm text-muted-foreground mt-1">All your deliveries, one place.</p>
        </div>

        <Card className="pt-0">
          <CardHeader>
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>Connect your Gmail to track deliveries</CardDescription>
          </CardHeader>

          {authError && (
            <div className="mx-6 mb-4 px-4 py-3 bg-red-950 border border-red-900 rounded-xl text-red-300 text-sm text-center" role="alert">
              {authError}
            </div>
          )}

          <CardFooter className="flex-col gap-3">
            <Button
              className="w-full gap-3 h-11"
              onClick={() => { window.location.href = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/auth/google`; }}
              aria-label="Sign in with Google"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Read-only Gmail access. Your data stays private.
            </p>
          </CardFooter>
        </Card>

        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: <Lock className="w-3.5 h-3.5" />, label: 'Read-only' },
            { icon: <RefreshCw className="w-3.5 h-3.5" />, label: 'Manual sync' },
            { icon: <Zap className="w-3.5 h-3.5" />, label: 'All carriers' },
          ].map(({ icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-1.5 py-3 bg-card border border-border rounded-xl">
              <span className="text-muted-foreground">{icon}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
