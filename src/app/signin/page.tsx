import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { SignInForm } from "./SignInForm";

export const dynamic = "force-dynamic";

/**
 * Session 10 slice. The page that was missing entirely — see
 * SignInForm.tsx for how that happened and why the tests could not catch
 * it.
 */
export default async function SignInPage() {
  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  // Already signed in: send them where they were trying to go rather than
  // showing a form that would confuse.
  if (user) redirect("/receipts");

  return (
    <main className="flex flex-col items-center gap-6 p-6 max-w-3xl mx-auto">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">receiptless</h1>
        <p className="text-sm text-neutral-500">Every receipt. Automatically. Forever.</p>
      </div>
      <SignInForm />
    </main>
  );
}
