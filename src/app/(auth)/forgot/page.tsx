import Link from "next/link";
import { AuthShell } from "@/components/features/auth/auth-shell";
import { ForgotForm } from "@/components/features/auth/auth-forms";

export const dynamic = "force-dynamic";

export default async function Forgot({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email you signed up with and we'll send a 6-digit code."
      footer={
        <Link href="/login" className="font-medium text-ink hover:text-s1">
          Back to sign in
        </Link>
      }
    >
      <ForgotForm email={sp.email} />
    </AuthShell>
  );
}
