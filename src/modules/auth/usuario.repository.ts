import prisma from "../../db/prisma.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface UsuarioConRol {
  id: number;
  username: string;
  password_hash: string;
  activo: boolean;
  rol_id: number;
  rol_nombre: string;
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
    activo: usuario.activo,
    rol_id: usuario.rol_id,
    rol_nombre: usuario.rol_usuario_rol_idTorol.nombre,
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
