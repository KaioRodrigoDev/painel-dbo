import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { deleteMailPackage, listMailPackages, packageInputSchema, saveMailPackage } from "@/lib/mail-packages";
import { loadItemCatalog } from "@/lib/item-catalog";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
const updateSchema = packageInputSchema.extend({ id: z.string().uuid() });
const deleteSchema = z.object({ id: z.string().uuid() }).strict();
async function withItemNames<T extends { items: { itemTblidx: number; quantity: number }[] }>(pkg: T) {
  const catalog = await loadItemCatalog();
  const names = new Map(catalog.items.map(item => [item.tblidx, item.name]));
  return { ...pkg, items: pkg.items.map(entry => ({ ...entry, name: names.get(entry.itemTblidx) ?? `Item ${entry.itemTblidx}` })) };
}

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const [packages, catalog] = await Promise.all([listMailPackages(), loadItemCatalog()]);
    const names = new Map(catalog.items.map(item => [item.tblidx, item.name]));
    return Response.json({ packages: packages.map(pkg => ({ ...pkg, items: pkg.items.map(entry => ({ ...entry, name: names.get(entry.itemTblidx) ?? `Item ${entry.itemTblidx}` })) })) });
  }
  catch (error) { console.error("Falha ao listar pacotes", error); return Response.json({ error: "Não foi possível ler os pacotes no servidor." }, { status: 503 }); }
}

async function mutate(request: Request, method: "POST" | "PUT" | "DELETE") {
  if (!(await authorizeApiRequest(request, true))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "Sessão expirada." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = (method === "POST" ? packageInputSchema : method === "PUT" ? updateSchema : deleteSchema).safeParse(body);
  if (!parsed.success) return Response.json({ error: "Dados do pacote inválidos." }, { status: 400 });
  try {
    if (method === "DELETE") {
      const pkg = await deleteMailPackage((parsed.data as z.infer<typeof deleteSchema>).id);
      await writeAuditLog({ administrator: session.username, action: "mail.package_delete", target: `${pkg.id}:${pkg.name}` }).catch(console.error);
      return Response.json({ deleted: pkg.id });
    }
    const data = parsed.data as z.infer<typeof updateSchema>;
    const pkg = await saveMailPackage({ name: data.name, items: data.items }, session.username, method === "PUT" ? data.id : undefined);
    await writeAuditLog({ administrator: session.username, action: method === "PUT" ? "mail.package_update" : "mail.package_create", target: `${pkg.id}:${pkg.name}` }).catch(console.error);
    return Response.json({ package: await withItemNames(pkg) }, { status: method === "POST" ? 201 : 200 });
  } catch (error) {
    console.error("Falha ao alterar pacote", error);
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o pacote." }, { status: 400 });
  }
}
export async function POST(request: Request) { return mutate(request, "POST"); }
export async function PUT(request: Request) { return mutate(request, "PUT"); }
export async function DELETE(request: Request) { return mutate(request, "DELETE"); }
