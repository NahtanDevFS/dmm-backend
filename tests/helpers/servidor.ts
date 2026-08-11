import type { Server } from "node:http";
import bcrypt from "bcrypt";
import app from "../../src/app.js";
import { poolOwner, idCatalogo } from "./bd.js";

/**
 * Levanta la app real en un puerto efimero y devuelve un cliente HTTP minimo.
 *
 * Se usa fetch de Node en vez de supertest para no agregar una dependencia:
 * lo unico que hace falta es conservar la cookie de sesion entre peticiones,
 * y eso son diez lineas.
 *
 * Importante: se ejerce la app COMPLETA (helmet, cors, rate limit, requireAuth,
 * requireRole, controladores). Probar los middlewares por separado no serviria:
 * lo que se quiere verificar es que una peticion real con el rol equivocado se
 * detiene antes de llegar al controlador.
 */

let servidor: Server | null = null;
let base = "";

export async function levantarServidor(): Promise<string> {
  if (servidor) return base;

  await new Promise<void>((resolve) => {
    servidor = app.listen(0, "127.0.0.1", () => resolve());
  });

  const dir = servidor!.address();
  if (!dir || typeof dir === "string") {
    throw new Error("No se pudo determinar el puerto del servidor de pruebas");
  }
  base = `http://127.0.0.1:${dir.port}`;
  return base;
}

export async function bajarServidor(): Promise<void> {
  if (!servidor) return;
  await new Promise<void>((resolve, reject) =>
    servidor!.close((e) => (e ? reject(e) : resolve())),
  );
  servidor = null;
  base = "";
}

export interface Sesion {
  cookie: string;
  usuarioId: number;
  username: string;
  rol: string;
}

export interface Respuesta {
  status: number;
  cuerpo: any;
}

/** Petición autenticada. Pase `sesion = null` para probar sin sesión. */
export async function pedir(
  metodo: string,
  ruta: string,
  sesion: Sesion | null = null,
  cuerpo?: unknown,
): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {};
  if (sesion) cabeceras.cookie = sesion.cookie;

  // fetch rechaza con TypeError si se le da cuerpo a un GET o HEAD, asi que se
  // ignora en esos casos en vez de obligar a cada llamador a acordarse.
  const admiteCuerpo = !["GET", "HEAD"].includes(metodo.toUpperCase());
  const enviarCuerpo = admiteCuerpo && cuerpo !== undefined;
  if (enviarCuerpo) cabeceras["content-type"] = "application/json";

  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: enviarCuerpo ? JSON.stringify(cuerpo) : undefined,
  });

  const texto = await res.text();
  let parseado: any = texto;
  try {
    parseado = texto ? JSON.parse(texto) : null;
  } catch {
    /* respuestas binarias (archivos, xlsx, pdf) se dejan como texto */
  }

  return { status: res.status, cuerpo: parseado };
}

const CLAVE_PRUEBA = "Prueba1234";

/**
 * Crea un usuario con el rol pedido e inicia sesion por HTTP real, para que la
 * cookie salga del mismo flujo que usa el frontend.
 *
 * El usuario se inserta con el pool del dueno porque en este punto todavia no
 * hay sesion con la que auditarlo, y `withUserTransaction` exige un usuario_id.
 */
export async function sesionComo(rol: string): Promise<Sesion> {
  const username = `test_${rol.toLowerCase()}`;
  const hash = await bcrypt.hash(CLAVE_PRUEBA, 12);
  const rolId = await idCatalogo("rol", rol);

  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.usuario (username, password_hash, rol_id, activo)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                          rol_id = EXCLUDED.rol_id,
                                          activo = true
     RETURNING id`,
    [username, hash, rolId],
  );

  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: CLAVE_PRUEBA }),
  });

  if (res.status !== 200) {
    throw new Error(
      `Login de prueba fallo para ${rol}: ${res.status} ${await res.text()}`,
    );
  }

  const setCookie =
    res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`El login de ${rol} no devolvio cookie`);

  return {
    cookie: setCookie.split(";")[0],
    usuarioId: rows[0].id,
    username,
    rol,
  };
}
