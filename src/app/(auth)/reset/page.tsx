import Link from "next/link";
import { AuthShell } from "@/components/features/auth/auth-shell";
import { ResetForm } from "@/components/features/auth/auth-forms";
import { emailDevFallback } from "@/server/integrations/email";
import { Callout } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Reset({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell
      title="Choose a new password"
      description="If an account exists for that email, a code is on its way. Codes expire after 10 minutes."
      footer={
        <>
          No code?{" "}
          <Link href={`/forgot${sp.email ? `?email=${encodeURIComponent(sp.email)}` : ""}`} className="font-medium text-ink hover:text-s1">
            Send another
          </Link>
        </>
      }
    >
      {emailDevFallback() && (
        <Callout tone="info" title="Development" className="mb-5">
          Email delivery isn&apos;t configured, so the code is printed in the server console.
        </Callout>
      )}
      <ResetForm email={sp.email} />
    </AuthShell>
  );
}
