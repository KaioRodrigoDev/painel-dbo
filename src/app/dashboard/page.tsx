import { redirect } from "next/navigation";

import { AdminDashboard } from "@/components/admin-dashboard";
import { getAdminConfig } from "@/lib/env";
import { getAdminSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  return (
    <AdminDashboard
      administrator={session.username}
      maxCharacterLevel={getAdminConfig().maxCharacterLevel}
    />
  );
}
