import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  poolOwner,
  resetBaseDePruebas,
  cerrarPools,
  idCatalogo,
} from "../helpers/bd.js";
import { escaparLike } from "../../src/lib/busqueda.js";
import { listarUsuarios } from "../../src/modules/usuarios/usuario.repository.js";

/**
 * QA-13: en ILIKE, "%" y "_" son comodines. Sin escaparlos, buscar "_"
 * devolvía todos los usuarios (el "_" equivale a cualquier carácter).
 */

describe("escaparLike", () => {
  it("escapa los comodines y la propia barra de escape", () => {
    expect(escaparLike("50%")).toBe("50\\%");
    expect(escaparLike("a_b")).toBe("a\\_b");
    expect(escaparLike("c:\\ruta")).toBe("c:\\\\ruta");
    expect(escaparLike("normal")).toBe("normal");
  });
});

describe("búsqueda de usuarios", () => {
  beforeAll(async () => {
    await resetBaseDePruebas();
    const rol = await idCatalogo("rol", "EMPLEADO_DMM");
    // Los usuarios de prueba llevan "test_" por la limpieza de resetBaseDePruebas;
    // "test_qa13.punto" solo tiene el "_" del prefijo, y "test_qa13_guion" tiene dos
    for (const username of ["test_qa13.punto", "test_qa13_guion"]) {
      await poolOwner.query(
        `INSERT INTO public.usuario (username, password_hash, rol_id, activo)
         VALUES ($1, 'x', $2, true)`,
        [username, rol],
      );
    }
  }, 60_000);

  afterAll(async () => {
    await cerrarPools();
  });

  const buscar = async (busqueda: string) =>
    (
      await listarUsuarios({
        busqueda,
        incluirInactivos: true,
        ocultarAdministradores: false,
        limite: 100,
        desplazamiento: 0,
      })
    ).filas.map((f) => f.username);

  it("un '_' busca un guion bajo de verdad, no cualquier carácter", async () => {
    // Como comodín, "qa13_" habría coincidido con "qa13." también
    expect(await buscar("qa13_")).toEqual(["test_qa13_guion"]);
  });

  it("un '%' no coincide con todo", async () => {
    expect(await buscar("%")).toEqual([]);
  });

  it("la búsqueda normal sigue funcionando", async () => {
    expect((await buscar("qa13")).sort()).toEqual([
      "test_qa13.punto",
      "test_qa13_guion",
    ]);
  });
});
