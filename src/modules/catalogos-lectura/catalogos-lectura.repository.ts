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

export interface TipoEvidenciaEntregaRow {
  id: number;
  nombre: string;
  activo: boolean;
}

/** `estado_solicitud_apoyo` no tiene columna `activo`: es un catálogo cerrado. */
export interface EstadoSolicitudRow {
  id: number;
  nombre: string;
}

export interface EstadoContratoRow {
  id: number;
  nombre: string;
  activo: boolean;
}

/** El monto sugerido se devuelve como string: es NUMERIC en la base. */
export interface TipoMultaRow {
  id: number;
  nombre: string;
  monto_sugerido: unknown;
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

export async function listarTiposEvidenciaEntrega(): Promise<
  TipoEvidenciaEntregaRow[]
> {
  return prisma.tipo_evidencia_entrega.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, activo: true },
  });
}

export async function listarTiposEvidenciaContrato(): Promise<
  TipoEvidenciaEntregaRow[]
> {
  return prisma.tipo_evidencia_contrato.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, activo: true },
  });
}

export async function listarEstadosSolicitud(): Promise<EstadoSolicitudRow[]> {
  return prisma.estado_solicitud_apoyo.findMany({
    orderBy: { id: "asc" },
    select: { id: true, nombre: true },
  });
}

export async function listarEstadosContrato(): Promise<EstadoContratoRow[]> {
  return prisma.estado_contrato_prestamo.findMany({
    where: { activo: true },
    orderBy: { id: "asc" },
    select: { id: true, nombre: true, activo: true },
  });
}

export async function listarTiposMulta(): Promise<TipoMultaRow[]> {
  return prisma.tipo_multa_prestamo.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, monto_sugerido: true, activo: true },
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

export async function existeTipoEvidenciaEntregaActivo(
  id: number,
): Promise<boolean> {
  const tipo = await prisma.tipo_evidencia_entrega.findUnique({
    where: { id },
    select: { activo: true },
  });
  return tipo?.activo === true;
}
