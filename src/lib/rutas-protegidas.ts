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

// Middleware suelto montado con
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

/** Recorre el router de `/api` y lanza si alguna ruta no declara sus roles */
export function verificarRutasProtegidas(routerApi: any): RutaEncontrada[] {
  const rutas: RutaEncontrada[] = [];

  // Si la verificación no puede ejecutarse, el arranque se detiene igual que
  // cuando encuentra una ruta desprotegida. Antes solo se registraba en consola
  // y el servidor arrancaba: el verificador quedaba apagado sin que nadie lo
  // notara. `router.stack` es una estructura interna de Express, no una API
  // pública, así que esto es lo que avisaría tras una actualización.
  const noSePudoVerificar = (detalle: string, causa?: unknown) =>
    new Error(
      `[rutas-protegidas] No se pudo verificar la matriz de rutas: ${detalle}\n` +
        "Probablemente cambió la estructura interna del router de Express " +
        "(router.stack): adapte recorrer() en src/lib/rutas-protegidas.ts.",
      { cause: causa },
    );

  const raiz = routerApi?.stack ?? routerApi?.router?.stack;
  if (!Array.isArray(raiz)) {
    throw noSePudoVerificar("no se encontró la lista de rutas del router.");
  }
  try {
    recorrer(raiz, false, rutas);
  } catch (error) {
    throw noSePudoVerificar("falló el recorrido de las rutas.", error);
  }
  // Un recorrido que "funciona" pero no reconoce ninguna ruta es la otra forma
  // de fallar en silencio: todo pasaría la revisión por no haber nada que revisar
  if (rutas.length === 0) {
    throw noSePudoVerificar("el recorrido no encontró ninguna ruta.");
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
