import path from "node:path";

/** Resuelve `solicitada` dentro de `raiz` y devuelve la ruta absoluta, o null si se sale de ella. La pertenencia se comprueba por segmentos: un startsWith aceptaría carpetas hermanas como uploads-old */
export function resolverDentroDe(
  raiz: string,
  solicitada: string,
): string | null {
  const base = path.resolve(raiz);
  const destino = path.resolve(base, solicitada);
  const relativa = path.relative(base, destino);

  if (
    relativa === "" ||
    relativa === ".." ||
    relativa.startsWith(".." + path.sep) ||
    path.isAbsolute(relativa)
  ) {
    return null;
  }
  return destino;
}
