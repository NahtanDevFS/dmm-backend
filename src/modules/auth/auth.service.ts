import bcrypt from "bcrypt";
import {
  buscarUsuarioPorUsername,
  buscarUsuarioPorId,
  actualizarUltimoLogin,
  type UsuarioConRol,
} from "./usuario.repository.js";
import {
  crearSesion,
  revocarSesion,
  type SesionRow,
} from "./session.repository.js";
import { generarTokenSesion } from "./session.utils.js";
import { BCRYPT_ROUNDS } from "../../config/seguridad.js";

/** Hash de relleno para comparar cuando el usuario no existe. Se calcula una sola vez, al cargar el módulo: por petición costaría el doble, y calculado en el primer login ese intento tardaría más que los demás. Usa el mismo coste que los hashes reales */
const hashFicticio = bcrypt.hash("dmm-usuario-inexistente", BCRYPT_ROUNDS);

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

  // Se compara siempre, exista o no el usuario: si el inexistente respondiera
  // sin pasar por bcrypt, la diferencia de tiempo delataría qué cuentas existen
  const passwordValida = await bcrypt.compare(
    password,
    usuario?.password_hash ?? (await hashFicticio),
  );
  if (!usuario || !passwordValida) {
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

  return { token, sesion, usuario: usuarioPublico(usuario) };
}

/** Lo que el frontend sabe del usuario con sesión. Lo comparten el login y GET /auth/me: antes /me devolvía solo id, username y rol, y al recargar la página se perdían el nombre completo y el programa a cargo */
function usuarioPublico(usuario: UsuarioConRol): LoginResult["usuario"] {
  return {
    id: usuario.id,
    username: usuario.username,
    nombre_completo: usuario.nombre_completo,
    rol: usuario.rol_nombre,
    programa_id: usuario.programa_id,
    programa_nombre: usuario.programa_nombre,
  };
}

/** Datos del usuario de la sesión vigente, con la misma forma que el login */
export async function usuarioDeSesion(
  usuarioId: number,
): Promise<LoginResult["usuario"] | null> {
  const usuario = await buscarUsuarioPorId(usuarioId);
  return usuario ? usuarioPublico(usuario) : null;
}

export async function logout(params: {
  sesionId: string;
  usuarioId: number;
}): Promise<void> {
  await revocarSesion(params.sesionId, params.usuarioId);
}
