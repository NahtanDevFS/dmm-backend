import prisma from "../../db/prisma.js";

export interface TipoGeneroRow {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface TipoParentescoRow {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface TipoDocumentoPersonaRow {
  id: number;
  nombre: string;
  activo: boolean;
}

export async function listarTiposGenero(): Promise<TipoGeneroRow[]> {
  return prisma.tipo_genero.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, activo: true },
  });
}

export async function listarTiposParentesco(): Promise<TipoParentescoRow[]> {
  return prisma.tipo_parentesco.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, activo: true },
  });
}

export async function listarTiposDocumentoPersona(): Promise<
  TipoDocumentoPersonaRow[]
> {
  return prisma.tipo_documento_persona.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, activo: true },
  });
}

export async function existeTipoGeneroActivo(id: number): Promise<boolean> {
  const tipo = await prisma.tipo_genero.findUnique({
    where: { id },
    select: { activo: true },
  });
  return tipo?.activo === true;
}

export async function existeTipoParentescoActivo(id: number): Promise<boolean> {
  const tipo = await prisma.tipo_parentesco.findUnique({
    where: { id },
    select: { activo: true },
  });
  return tipo?.activo === true;
}

export async function existeTipoDocumentoPersonaActivo(
  id: number,
): Promise<boolean> {
  const tipo = await prisma.tipo_documento_persona.findUnique({
    where: { id },
    select: { activo: true },
  });
  return tipo?.activo === true;
}
