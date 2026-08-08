import { pool } from "../../db/pool.js";

export interface AuditoriaRow {
  /** bigserial: pg lo devuelve como string, así que no rompe JSON.stringify. */
  id: string;
  tabla_afectada: string;
  registro_id: number;
  accion: string;
  usuario_id: number | null;
  usuario_username: string | null;
  fecha_hora: Date;
  valores_antiguos: Record<string, unknown> | null;
  valores_nuevos: Record<string, unknown> | null;
}

/**
 * `fn_auditoria` guarda la fila completa con `to_jsonb(NEW)`, sin distinguir
 * columnas sensibles. Eso deja el hash de contraseña de `usuario` y el hash del
 * token de sesión dentro de `auditoria_log`, así que este endpoint tiene que
 * redactarlos antes de responder: son material de credenciales y no deben salir
 * del backend, ni siquiera hacia un ADMINISTRADOR.
 *
 * Sanear la propia función de auditoría en la base de datos sería mejor, pero es
 * un cambio de esquema; mientras tanto la API no los expone.
 */
const CAMPOS_REDACTADOS: Record<string, string[]> = {
  usuario: ["password_hash"],
  sesion: ["token_hash"],
};

const MARCA_REDACTADO = "[redactado]";

function redactar(
  tabla: string,
  valores: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (valores === null) return null;
  const sensibles = CAMPOS_REDACTADOS[tabla];
  if (!sensibles) return valores;

  const copia = { ...valores };
  for (const campo of sensibles) {
    if (campo in copia) copia[campo] = MARCA_REDACTADO;
  }
  return copia;
}

export async function listarAuditoria(params: {
  tabla?: string;
  registroId?: number;
  usuarioId?: number;
  accion?: string;
  desde?: string;
  hasta?: string;
  limite: number;
  desplazamiento: number;
}): Promise<{ total: number; filas: AuditoriaRow[] }> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  const agregar = (plantilla: (n: string) => string, valor: unknown) => {
    valores.push(valor);
    condiciones.push(plantilla(`$${valores.length}`));
  };

  if (params.tabla) agregar((n) => `a.tabla_afectada = ${n}`, params.tabla);
  if (params.registroId !== undefined)
    agregar((n) => `a.registro_id = ${n}`, params.registroId);
  if (params.usuarioId !== undefined)
    agregar((n) => `a.usuario_id = ${n}`, params.usuarioId);
  if (params.accion) agregar((n) => `t.nombre = ${n}`, params.accion);
  if (params.desde)
    agregar((n) => `a.fecha_hora >= ${n}::timestamp`, params.desde);
  // `hasta` se interpreta como el día completo: una fecha sin hora significaría
  // medianoche y dejaría fuera todo lo del propio día.
  if (params.hasta)
    agregar(
      (n) => `a.fecha_hora < (${n}::date + INTERVAL '1 day')`,
      params.hasta,
    );

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const totalResult = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM public.auditoria_log a
     JOIN public.tipo_accion_auditoria t ON t.id = a.tipo_accion_id
     ${where}`,
    valores,
  );

  const result = await pool.query<AuditoriaRow>(
    `SELECT a.id, a.tabla_afectada, a.registro_id, t.nombre AS accion,
            a.usuario_id, u.username AS usuario_username, a.fecha_hora,
            a.valores_antiguos, a.valores_nuevos
     FROM public.auditoria_log a
     JOIN public.tipo_accion_auditoria t ON t.id = a.tipo_accion_id
     LEFT JOIN public.usuario u ON u.id = a.usuario_id
     ${where}
     ORDER BY a.fecha_hora DESC, a.id DESC
     LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, params.limite, params.desplazamiento],
  );

  return {
    total: totalResult.rows[0]?.n ?? 0,
    filas: result.rows.map((f) => ({
      ...f,
      valores_antiguos: redactar(f.tabla_afectada, f.valores_antiguos),
      valores_nuevos: redactar(f.tabla_afectada, f.valores_nuevos),
    })),
  };
}

/** Tablas que tienen registros de auditoría, para poblar el filtro. */
export async function listarTablasAuditadas(): Promise<
  { tabla: string; registros: number }[]
> {
  const result = await pool.query<{ tabla: string; registros: number }>(
    `SELECT tabla_afectada AS tabla, count(*)::int AS registros
     FROM public.auditoria_log
     GROUP BY tabla_afectada
     ORDER BY tabla_afectada`,
  );
  return result.rows;
}

/** Historial completo de un registro concreto, del más antiguo al más reciente. */
export async function historialDeRegistro(
  tabla: string,
  registroId: number,
): Promise<AuditoriaRow[]> {
  const result = await pool.query<AuditoriaRow>(
    `SELECT a.id, a.tabla_afectada, a.registro_id, t.nombre AS accion,
            a.usuario_id, u.username AS usuario_username, a.fecha_hora,
            a.valores_antiguos, a.valores_nuevos
     FROM public.auditoria_log a
     JOIN public.tipo_accion_auditoria t ON t.id = a.tipo_accion_id
     LEFT JOIN public.usuario u ON u.id = a.usuario_id
     WHERE a.tabla_afectada = $1 AND a.registro_id = $2
     ORDER BY a.fecha_hora, a.id`,
    [tabla, registroId],
  );
  return result.rows.map((f) => ({
    ...f,
    valores_antiguos: redactar(f.tabla_afectada, f.valores_antiguos),
    valores_nuevos: redactar(f.tabla_afectada, f.valores_nuevos),
  }));
}

export { CAMPOS_REDACTADOS, MARCA_REDACTADO };
