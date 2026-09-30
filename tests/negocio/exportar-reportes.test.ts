import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import {
  levantarServidor,
  bajarServidor,
  sesionComo,
  type Sesion,
} from "../helpers/servidor.js";
import {
  resetBaseDePruebas,
  cerrarPools,
  poolOwner,
  idCatalogo,
} from "../helpers/bd.js";
import { crearInsumo, crearLote, crearPersona } from "../helpers/fixtures.js";
import { formatearValor } from "../../src/lib/reportes/exportar.js";

// Exportación de reportes a Excel y PDF.
//
// Los archivos mostraban los identificadores del catálogo (FEMENINO,
// ADULTO_MAYOR) y las fechas como 2026-09-29. La pantalla ya los traducía;
// los archivos se generan en el backend y no pasaban por esa traducción.

let base: string;
let directora: Sesion;

beforeAll(async () => {
  await resetBaseDePruebas();
  base = await levantarServidor();
  directora = await sesionComo("DIRECTORA");

  // Una entrega a una adulta mayor, para que ambos reportes tengan una fila
  const personaId = await crearPersona(directora.usuarioId, {
    nombres: "Exportada",
    fechaNacimiento: "1950-03-14",
  });
  await poolOwner.query(`UPDATE public.persona SET genero_id = $1 WHERE id = $2`, [
    await idCatalogo("tipo_genero", "FEMENINO"),
    personaId,
  ]);
  const insumo = await crearInsumo(directora.usuarioId);
  await crearLote(directora.usuarioId, insumo, { cantidad: 5 });
  await poolOwner.query(
    `CALL public.sp_registrar_entrega($1, $2, $3, $4, $5, $6, $7, $8)`,
    [null, personaId, insumo.insumoId, 1, directora.usuarioId, null, null, null],
  );
  await poolOwner.query(
    `UPDATE public.entrega SET fecha_entrega = '2026-09-05' WHERE persona_id = $1`,
    [personaId],
  );
}, 60_000);

afterAll(async () => {
  await bajarServidor();
  await cerrarPools();
});

/** Descarga el Excel de un reporte y devuelve encabezados y filas como texto. */
async function descargarExcel(ruta: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${base}${ruta}`, { headers: { cookie: directora.cookie } });
  expect(res.status).toBe(200);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(await res.arrayBuffer()) as never);
  const hoja = libro.worksheets[0];
  const titulos = (hoja.getRow(1).values as unknown[]).slice(1).map(String);
  const filas: Record<string, unknown>[] = [];
  hoja.eachRow((fila, n) => {
    if (n === 1) return;
    const valores = (fila.values as unknown[]).slice(1);
    filas.push(Object.fromEntries(titulos.map((t, i) => [t, valores[i]])));
  });
  // El formato de número de cada columna, para revisar las fechas
  filas.push({ __formatos: titulos.map((_, i) => hoja.getColumn(i + 1).numFmt) });
  return filas;
}

describe("Excel", () => {
  it("personas atendidas: género legible y fecha como día/mes/año", async () => {
    const filas = await descargarExcel(
      "/api/reportes/personas-atendidas?formato=xlsx&desde=2026-09-01&hasta=2026-09-30",
    );
    const fila = filas.find((f) => f["Beneficiario"] === "Exportada De Prueba");
    expect(fila).toBeDefined();
    expect(fila!["Género"]).toBe("Femenino");

    const fecha = fila!["Fecha"] as Date;
    expect(fecha.getUTCFullYear()).toBe(2026);
    expect(fecha.getUTCMonth()).toBe(8); // septiembre
    expect(fecha.getUTCDate()).toBe(5);
    expect((filas.at(-1)!.__formatos as string[])).toContain("dd/mm/yyyy");
  });

  it("población beneficiada: grupo etario legible y el mes como mes/año", async () => {
    const filas = await descargarExcel(
      "/api/reportes/poblacion-beneficiada?formato=xlsx&desde=2026-09-01&hasta=2026-09-30",
    );
    const datos = filas.slice(0, -1);
    expect(datos.length).toBeGreaterThan(0);
    expect(datos.some((f) => Object.values(f).includes("Adulto mayor"))).toBe(true);
    expect(datos.some((f) => Object.values(f).includes("ADULTO_MAYOR"))).toBe(false);
    expect((filas.at(-1)!.__formatos as string[])).toContain("mm/yyyy");
  });
});

describe("PDF: texto de cada celda", () => {
  it("traduce las columnas de catálogo y deja igual el resto", () => {
    expect(formatearValor("genero", "FEMENINO")).toBe("Femenino");
    expect(formatearValor("grupo_etario", "ADULTO_MAYOR")).toBe("Adulto mayor");
    expect(formatearValor("grupo_etario", "MENOR")).toBe("Menor de edad");
    expect(formatearValor("comunidad_nombre", "SANTA_CRUZ")).toBe("SANTA_CRUZ");
  });

  it("escribe las fechas como en Guatemala", () => {
    // node-postgres entrega un DATE como medianoche local de ese día
    expect(formatearValor("fecha_entrega", new Date(2026, 8, 5))).toBe("05/09/2026");
    expect(formatearValor("mes", new Date(2026, 8, 1))).toBe("09/2026");
  });
});
