import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { shellData } from "@/server/queries/shell";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { THEME_BOOT, ThemeSync } from "@/components/layout/theme";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, project, role, db } = await requireProject();
  const { shell, notices } = await shellData(db, user, project, role);
  return (
    <div className="flex min-h-screen">
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <ThemeSync />
      <aside className="sticky top-0 hidden h-screen w-[256px] shrink-0 border-r border-line md:block">
        <Sidebar {...shell} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar shell={shell} notices={notices} canOperate={can(role, "operate")} />
        <main className="app-main mx-auto w-full max-w-[1280px] flex-1 px-4 py-7 md:px-9 md:py-9">{children}</main>
      </div>
    </div>
  );
}
