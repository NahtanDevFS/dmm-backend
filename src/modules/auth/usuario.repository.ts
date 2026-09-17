import prisma from "../../db/prisma.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface UsuarioConRol {
  id: number;
  username: string;
  password_hash: string;
  nombre_completo: string | null;
  activo: boolean;
  rol_id: number;
  rol_nombre: string;
  /** Programa del que es encargada, para preseleccionarlo en solicitudes. */
  programa_id: number | null;
  programa_nombre: string | null;
}

export async function buscarUsuarioPorUsername(
  username: string,
): Promise<UsuarioConRol | null> {
  const usuario = await prisma.usuario.findUnique({
    where: { username },
    include: { rol_usuario_rol_idTorol: true },
  });

  if (!usuario) return null;

  return {
    id: usuario.id,
    username: usuario.username,
    password_hash: usuario.password_hash,
    nombre_completo: usuario.nombre_completo,
    activo: usuario.activo,
    rol_id: usuario.rol_id,
    rol_nombre: usuario.rol_usuario_rol_idTorol.nombre,
    programa_id: usuario.programa_id,
    /*
      El nombre se busca aparte en vez de con un include. Prisma bautiza las
      relaciones al introspeccionar y ese nombre depende de cómo quedó la
      clave foránea; una consulta directa por id no depende de eso y sobrevive
      al próximo `prisma db pull`.
    */
    programa_nombre: usuario.programa_id
      ? ((
          await prisma.programa.findUnique({
            where: { id: usuario.programa_id },
            select: { nombre: true },
          })
        )?.nombre ?? null)
      : null,
  };
}

export async function actualizarUltimoLogin(usuarioId: number): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.usuario
       SET ultimo_login = CURRENT_TIMESTAMP, updated_by = $1
       WHERE id = $1`,
      [usuarioId],
    );
  });
}
