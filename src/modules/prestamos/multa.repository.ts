import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface MultaRow {
  id: number;
  contrato_prestamo_id: number;
  tipo_multa_id: number;
  monto: string;
  fecha_aplicacion: Date;
  motivo: string | null;
  pagada: boolean;
  fecha_pago: Date | null;
  activo: boolean;
}

const COLUMNAS = `id, contrato_prestamo_id, tipo_multa_id, monto,
  fecha_aplicacion, motivo, pagada, fecha_pago, activo`;

export async function listarMultasDeContrato(
  contratoId: number,
  incluirAnuladas: boolean,
): Promise<Record<string, unknown>[]> {
  const result = await pool.query(
    `SELECT m.id, m.contrato_prestamo_id, m.tipo_multa_id, m.monto,
            m.fecha_aplicacion, m.motivo, m.pagada, m.fecha_pago, m.activo,
            t.nombre AS tipo_multa_nombre
     FROM public.multa_prestamo m
     JOIN public.tipo_multa_prestamo t ON t.id = m.tipo_multa_id
     WHERE m.contrato_prestamo_id = $1 ${incluirAnuladas ? "" : "AND m.activo = true"}
     ORDER BY m.fecha_aplicacion, m.id`,
    [contratoId],
  );
  return result.rows;
}

export async function buscarMultaPorId(id: number): Promise<MultaRow | null> {
  const result = await pool.query<MultaRow>(
    `SELECT ${COLUMNAS} FROM public.multa_prestamo WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function buscarTipoMultaActivo(
  id: number,
): Promise<{ nombre: string; monto_sugerido: string | null } | null> {
  const tipo = await prisma.tipo_multa_prestamo.findUnique({
    where: { id },
    select: { nombre: true, monto_sugerido: true, activo: true },
  });
  if (tipo?.activo !== true) return null;
  return {
    nombre: tipo.nombre,
    monto_sugerido: tipo.monto_sugerido?.toString() ?? null,
  };
}

export async function aplicarMulta(
  usuarioId: number,
  contratoId: number,
  datos: {
    tipo_multa_id: number;
    monto: number;
    motivo?: string | null;
    fecha_aplicacion?: string;
  },
): Promise<MultaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const campos = ["contrato_prestamo_id", "tipo_multa_id", "monto", "motivo"];
    const valores: unknown[] = [
      contratoId,
      datos.tipo_multa_id,
      datos.monto,
      datos.motivo ?? null,
    ];

    if (datos.fecha_aplicacion !== undefined) {
      campos.push("fecha_aplicacion");
      valores.push(datos.fecha_aplicacion);
    }

    campos.push("created_by");
    valores.push(usuarioId);

    const placeholders = valores.map((_, i) => `$${i + 1}`).join(", ");
    const result = await client.query<MultaRow>(
      `INSERT INTO public.multa_prestamo (${campos.join(", ")})
       VALUES (${placeholders})
       RETURNING ${COLUMNAS}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function editarMulta(
  usuarioId: number,
  id: number,
  datos: { monto?: number; motivo?: string | null },
): Promise<MultaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of ["monto", "motivo"] as const) {
      if (campo in datos) {
        sets.push(`${campo} = $${i}`);
        valores.push(datos[campo]);
        i += 1;
      }
    }

    sets.push(`updated_by = $${i}`);
    valores.push(usuarioId);
    i += 1;
    valores.push(id);

    const result = await client.query<MultaRow>(
      `UPDATE public.multa_prestamo SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING ${COLUMNAS}`,
      valores,
    );
    return result.rows[0];
  });
}

/**
 * El CHECK multa_prestamo_pago_coherente exige que `pagada` y `fecha_pago` se
 * muevan juntas, así que se actualizan en la misma sentencia.
 */
export async function marcarMultaPagada(
  usuarioId: number,
  id: number,
  fechaPago?: string,
): Promise<MultaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<MultaRow>(
      `UPDATE public.multa_prestamo
       SET pagada = true,
           fecha_pago = COALESCE($1::date, CURRENT_DATE),
           updated_by = $2
       WHERE id = $3
       RETURNING ${COLUMNAS}`,
      [fechaPago ?? null, usuarioId, id],
    );
    return result.rows[0];
  });
}

/** Borrado lógico: una multa mal aplicada se anula, no se borra. */
export async function anularMulta(
  usuarioId: number,
  id: number,
): Promise<MultaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<MultaRow>(
      `UPDATE public.multa_prestamo SET activo = false, updated_by = $1
       WHERE id = $2
       RETURNING ${COLUMNAS}`,
      [usuarioId, id],
    );
    return result.rows[0];
  });
}
