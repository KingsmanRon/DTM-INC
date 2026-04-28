import Link from "next/link";

export default function UnauthorisedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Access not authorised</h1>
        <p className="text-text-secondary text-sm">
          Signed in, but this account is not authorised for staff access.
          Please contact an administrator.
        </p>
        <Link href="/login" className="btn-primary inline-flex">Back to sign in</Link>
      </div>
    </main>
  );
}
