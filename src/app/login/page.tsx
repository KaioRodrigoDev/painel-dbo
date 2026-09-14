import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { isAdminAuthenticated } from "@/lib/session";

export default async function LoginPage() {
  if (await isAdminAuthenticated()) redirect("/dashboard");

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="brandMark" aria-hidden="true"><span>★</span></div>
        <div className="eyebrow">ACESSO RESTRITO</div>
        <h1>Dbo World Admin</h1>
        <p className="muted">
          Consulte contas e administre personagens sem expor o banco ao navegador.
        </p>
        <LoginForm />
        <p className="securityNote">Sessão local protegida por cookie HttpOnly · 8 horas</p>
      </section>
    </main>
  );
}
