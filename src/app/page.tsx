import { redirect } from "next/navigation";

import { isAdminAuthenticated } from "@/lib/session";

export default async function Home() {
  redirect((await isAdminAuthenticated()) ? "/dashboard" : "/login");
}
