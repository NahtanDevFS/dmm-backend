import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";
import { calcularExpiracionSesion, hashToken } from "./session.utils.js";

export interface SesionRow {
  id: string; // bigserial -> pg lo devuelve como string
  usuario_id: number;
  token_hash: string;
  ip_origen: string | null;
  user_agent: string | null;
  ultima_actividad: Date;
  expira_en: Date;
  revocada_en: Date | null;
}

export async function crearSesion(params: {
  usuarioId: number;
  token: string;
  ipOrigen: string | null;
  userAgent: string | null;
}): Promise<SesionRow> {
  const { usuarioId, token, ipOrigen, userAgent } = params;
  const tokenHash = hashToken(token);
  const expiraEn = calcularExpiracionSesion();

  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<SesionRow>(
      `INSERT INTO public.sesion
         (usuario_id, token_hash, ip_origen, user_agent, expira_en, created_by)
       VALUES ($1, $2, $3, $4, $5, $1)
       RETURNING id, usuario_id, token_hash, ip_origen, user_agent,
                 ultima_actividad, expira_en, revocada_en`,
      [usuarioId, tokenHash, ipOrigen, userAgent, expiraEn],
    );
    return result.rows[0];
  });
}

export async function buscarSesionPorToken(
  token: string,
): Promise<SesionRow | null> {
  const tokenHash = hashToken(token);
  const result = await pool.query<SesionRow>(
    `SELECT id, usuario_id, token_hash, ip_origen, user_agent,
            ultima_actividad, expira_en, revocada_en
     FROM public.sesion
     WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function actualizarUltimaActividad(
  sesionId: string,
  usuarioId: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.sesion SET ultima_actividad = CURRENT_TIMESTAMP, updated_by = $2
       WHERE id = $1`,
      [sesionId, usuarioId],
    );
  });
}

export async function revocarSesion(
  sesionId: string,
  revocadoPor: number,
): Promise<void> {
  await withUserTransaction(revocadoPor, async (client) => {
    await client.query(
      `UPDATE public.sesion
       SET revocada_en = CURRENT_TIMESTAMP, updated_by = $2
       WHERE id = $1 AND revocada_en IS NULL`,
      [sesionId, revocadoPor],
    );
  });
}
