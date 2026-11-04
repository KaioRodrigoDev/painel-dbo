import Image from "next/image";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { isAdminAuthenticated } from "@/lib/session";

export default async function LoginPage() {
  if (await isAdminAuthenticated()) redirect("/dashboard");

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="loginBrand">
          <Image src="/images/DB_1ST.png" alt="" width={52} height={52} priority className="brandOrb" />
          <div><strong>MDBO</strong><span>Painel administrativo</span></div>
        </div>
        <div className="eyebrow">ACESSO RESTRITO</div>
        <h1>Entrar no painel</h1>
        <p className="muted">
          Consulte contas e administre personagens sem expor o banco ao navegador.
        </p>
        <LoginForm />
        <p className="securityNote">Sessão local protegida por cookie HttpOnly · 8 horas</p>
      </section>
    </main>
  );
}
