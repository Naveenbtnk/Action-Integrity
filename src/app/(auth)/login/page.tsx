import Link from 'next/link';

import { SignInPanel } from '@/components/auth/SignInPanel';

export default function LoginPage() {
  return (
    <main id="main-content" className="grid min-h-screen place-items-center px-6 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 block text-sm text-muted-foreground hover:text-foreground">
          ACTION INTEGRITY
        </Link>
        <SignInPanel />
      </div>
    </main>
  );
}
