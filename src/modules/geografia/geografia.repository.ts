import prisma from "../../db/prisma.js";

export interface DepartamentoRow {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface MunicipioRow {
  id: number;
  departamento_id: number;
  nombre: string;
  activo: boolean;
}

export async function listarDepartamentos(): Promise<DepartamentoRow[]> {
  return prisma.departamento.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, activo: true },
  });
}

export async function listarMunicipios(
  departamentoId?: number,
): Promise<MunicipioRow[]> {
  return prisma.municipio.findMany({
    where: {
      activo: true,
      ...(departamentoId !== undefined
        ? { departamento_id: departamentoId }
        : {}),
    },
    orderBy: { nombre: "asc" },
    select: { id: true, departamento_id: true, nombre: true, activo: true },
  });
}

export async function existeMunicipioActivo(id: number): Promise<boolean> {
  const municipio = await prisma.municipio.findUnique({
    where: { id },
    select: { activo: true },
  });
  return municipio?.activo === true;
}
