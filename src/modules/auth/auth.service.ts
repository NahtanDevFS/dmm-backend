import bcrypt from "bcrypt";
import {
  buscarUsuarioPorUsername,
  actualizarUltimoLogin,
} from "./usuario.repository.js";
import {
  crearSesion,
  revocarSesion,
  type SesionRow,
} from "./session.repository.js";
import { generarTokenSesion } from "./session.utils.js";

export class CredencialesInvalidasError extends Error {
  constructor() {
    super("Usuario o contraseña incorrectos");
    this.name = "CredencialesInvalidasError";
  }
}

export class UsuarioInactivoError extends Error {
  constructor() {
    super("Su cuenta ha sido suspendida. Contacte al administrador");
    this.name = "UsuarioInactivoError";
  }
}

export interface LoginResult {
  token: string;
  sesion: SesionRow;
  usuario: {
    id: number;
    username: string;
    /** Nombre de la persona, para saludar y firmar con él en vez del alias */
    nombre_completo: string | null;
    rol: string;
    /** Programa del que es encargada, para preseleccionarlo al crear unasolicitud */
    programa_id: number | null;
    programa_nombre: string | null;
  };
}

export async function login(params: {
  username: string;
  password: string;
  ipOrigen: string | null;
  userAgent: string | null;
}): Promise<LoginResult> {
  const { username, password, ipOrigen, userAgent } = params;

  const usuario = await buscarUsuarioPorUsername(username);

  if (!usuario) {
    throw new CredencialesInvalidasError();
  }

  const passwordValida = await bcrypt.compare(password, usuario.password_hash);
  if (!passwordValida) {
    throw new CredencialesInvalidasError();
  }

  if (!usuario.activo) {
    throw new UsuarioInactivoError();
  }

  const token = generarTokenSesion();
  const sesion = await crearSesion({
    usuarioId: usuario.id,
    token,
    ipOrigen,
    userAgent,
  });

  await actualizarUltimoLogin(usuario.id);

  return {
    token,
    sesion,
    usuario: {
      id: usuario.id,
      username: usuario.username,
      nombre_completo: usuario.nombre_completo,
      rol: usuario.rol_nombre,
      programa_id: usuario.programa_id,
      programa_nombre: usuario.programa_nombre,
    },
  };
}

export async function logout(params: {
  sesionId: string;
  usuarioId: number;
}): Promise<void> {
  await revocarSesion(params.sesionId, params.usuarioId);
}
