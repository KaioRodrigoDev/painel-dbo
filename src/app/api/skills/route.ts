import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeApiRequest } from "@/lib/security";
import { loadSkillCatalog } from "@/lib/skill-catalog";
import type { SkillCatalogResponse } from "@/lib/types";

export const runtime = "nodejs";

const querySchema = z.object({
  search: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(3000).default(30),
  skillClass: z.coerce.number().int().min(0).max(255).optional(),
  skillType: z.coerce.number().int().min(0).max(255).optional(),
  characterClass: z.coerce.number().int().min(0).max(20).optional(),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    search: url.searchParams.get("search") ?? "",
    page: url.searchParams.get("page") ?? "1",
    pageSize: url.searchParams.get("pageSize") ?? "30",
    skillClass: url.searchParams.get("skillClass") ?? undefined,
    skillType: url.searchParams.get("skillType") ?? undefined,
    characterClass: url.searchParams.get("characterClass") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });

  try {
    const catalog = await loadSkillCatalog();
    const search = parsed.data.search.toLocaleLowerCase();
    const filtered = catalog.skills.filter((skill) => {
      const matchesSearch = !search || skill.name.toLocaleLowerCase().includes(search) || skill.internalName.toLocaleLowerCase().includes(search) || skill.iconName.toLocaleLowerCase().includes(search) || String(skill.tblidx).includes(search);
      const matchesCharacterClass = parsed.data.characterClass === undefined || (skill.classFlag & (1 << parsed.data.characterClass)) !== 0;
      return matchesSearch && matchesCharacterClass && (parsed.data.skillClass === undefined || skill.skillClass === parsed.data.skillClass) && (parsed.data.skillType === undefined || skill.skillType === parsed.data.skillType);
    });

    const pageSize = parsed.data.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(parsed.data.page, totalPages);
    const response: SkillCatalogResponse = {
      skills: filtered.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: filtered.length,
      totalPages,
      sourceFile: path.basename(catalog.path),
      textSourceFile: path.basename(catalog.textPath),
      sourceUpdatedAt: new Date(catalog.modifiedAt).toISOString(),
      availableSkillClasses: [...new Set(catalog.skills.map((skill) => skill.skillClass))].sort((a, b) => a - b),
      availableSkillTypes: [...new Set(catalog.skills.map((skill) => skill.skillType))].sort((a, b) => a - b),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Falha ao ler o catálogo de skills", error);
    return NextResponse.json({ error: "Não foi possível ler o Table_Skill_Data.rdf configurado." }, { status: 503 });
  }
}
