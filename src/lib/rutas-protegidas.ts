interface RutaEncontrada {
  metodo: string;
  ruta: string;
  handlers: string[];
  estado: "con-rol" | "sin-rol-declarado" | "desprotegida";
}

function nombresDeHandlers(pila: any[]): string[] {
  return pila
    .map((h: any) => h?.handle?.name)
    .filter((n: string) => n && n !== "<anonymous>" && n !== "handler");
}

function recorrer(
  capas: any[],
  hereda: boolean,
  salida: RutaEncontrada[],
): void {
  for (const capa of capas ?? []) {
    if (capa?.route) {
      const pila = capa.route.stack ?? [];
      const tieneRol =
        hereda ||
        pila.some((h: any) => h?.handle?.rolesPermitidos !== undefined);
      const exento = pila.some(
        (h: any) => h?.handle?.motivoSinRol !== undefined,
      );

      const metodos = Object.keys(capa.route.methods ?? {}).filter(
        (m) => capa.route.methods[m],
      );

      for (const metodo of metodos) {
        salida.push({
          metodo: metodo.toUpperCase(),
          ruta: capa.route.path ?? "(desconocida)",
          handlers: nombresDeHandlers(pila),
          estado: tieneRol
            ? "con-rol"
            : exento
              ? "sin-rol-declarado"
              : "desprotegida",
        });
      }
      continue;
    }

    const sub = capa?.handle;

    // Middleware suelto montado con .use(): protege todo lo que cuelga de él.
    if (
      typeof sub === "function" &&
      (sub as any).rolesPermitidos !== undefined
    ) {
      hereda = true;
      continue;
    }

    if (Array.isArray(sub?.stack)) {
      recorrer(sub.stack, hereda, salida);
    }
  }
}

/**
 * Recorre el router de `/api` y lanza si alguna ruta no declara sus roles.
 *
 * Si el recorrido en sí falla (por ejemplo porque una versión futura de Express
 * cambia la forma del stack), se registra el problema y se deja arrancar: una
 * guarda rota no debe impedir un despliegue, pero tampoco debe pasar
 * desapercibida.
 */
export function verificarRutasProtegidas(routerApi: any): RutaEncontrada[] {
  const rutas: RutaEncontrada[] = [];

  try {
    const raiz = routerApi?.stack ?? routerApi?.router?.stack;
    if (!Array.isArray(raiz)) {
      console.error(
        "[rutas-protegidas] No se pudo leer el árbol de rutas; la verificación de permisos NO se ejecutó.",
      );
      return [];
    }
    recorrer(raiz, false, rutas);
  } catch (error) {
    console.error(
      "[rutas-protegidas] Falló la verificación (se permite el arranque):",
      error,
    );
    return [];
  }

  const desprotegidas = rutas.filter((r) => r.estado === "desprotegida");

  if (desprotegidas.length > 0) {
    const detalle = desprotegidas
      .map(
        (r) =>
          `  ${r.metodo.padEnd(6)} ${r.ruta.padEnd(28)} ${r.handlers.join(", ")}`,
      )
      .join("\n");

    throw new Error(
      `Hay ${desprotegidas.length} ruta(s) sin declarar sus roles:\n${detalle}\n\n` +
        "Cada ruta debe llevar requireRole(...) con un conjunto de\n" +
        'src/config/roles.ts, o bien permitirSinRol("motivo") si de verdad debe\n' +
        "estar abierta a cualquier usuario autenticado.",
    );
  }

  return rutas;
}
