import Link from "next/link";
import { auth } from "@/auth";
import { isAdminGitHubId } from "@/lib/admin/access";
import { AdminDashboard } from "@/components/admin-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · RepoShield", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user || !isAdminGitHubId(session.user.githubId)) {
    return (
      <main className="mx-auto max-w-xl px-5 py-24">
        <section className="glass rounded-2xl p-8">
          <p className="text-xs uppercase tracking-[0.18em] text-primary">RepoShield admin</p>
          <h1 className="mt-3 font-display text-2xl font-semibold">{session?.user ? "Administrator access required" : "Sign in to continue"}</h1>
          <p className="mt-3 text-sm leading-6 text-mist">{session?.user ? "Your account does not have access to the admin dashboard. Contact the project owner to request access." : "Sign in with your authorized GitHub account from the scanner, then open the admin dashboard."}</p>
          <Link href="/" className="btn-primary mt-6">Back to scanner</Link>
        </section>
      </main>
    );
  }
  return <AdminDashboard login={session.user.login ?? "Admin"} />;
}
