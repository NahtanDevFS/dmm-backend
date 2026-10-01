import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  levantarServidor,
  bajarServidor,
  sesionComo,
  pedir,
  type Sesion,
} from "../helpers/servidor.js";
import {
  resetBaseDePruebas,
  cerrarPools,
  poolOwner,
  idCatalogo,
} from "../helpers/bd.js";
import { crearInsumo, crearPersona } from "../helpers/fixtures.js";
import {
  bloquesDeFormulario,
  totalDeGrupo,
} from "../../src/lib/reportes/expediente.js";
import type { RespuestaExpediente } from "../../src/modules/solicitudes/expediente.repository.js";

// Secciones de formulario y unión de la hoja de aptitud (migración 31).
//
// En papel, la «Solicitud de silla de ruedas» tiene dos hojas y varias
// secciones; el sistema las tenía como dos formularios sin títulos.

let directora: Sesion;

const SOLICITUD = "Solicitud de silla de ruedas";
const APTITUD = "Formulario de aptitud para silla de ruedas";
const MIGRACION = readFileSync(
  fileURLToPath(
    new URL("../../db/migraciones/31_secciones_y_formularios_silla.sql", import.meta.url),
  ),
  "utf8",
);

async function borrarFormularios(): Promise<void> {
  // dmm_test no trae formularios; estos son solo de esta prueba. Las hojas
  // llenas los referencian sin cascada: se van primero.
  const deEstaPrueba = `SELECT id FROM public.formulario
     WHERE nombre IN ($1, $2) OR nombre LIKE 'Prueba secciones%'`;
  await poolOwner.query(
    `DELETE FROM public.detalle_solicitud_formulario_respuesta
     WHERE detalle_solicitud_formulario_id IN (
       SELECT id FROM public.detalle_solicitud_formulario
       WHERE formulario_id IN (${deEstaPrueba}))`,
    [SOLICITUD, APTITUD],
  );
  await poolOwner.query(
    `DELETE FROM public.detalle_solicitud_formulario WHERE formulario_id IN (${deEstaPrueba})`,
    [SOLICITUD, APTITUD],
  );
  await poolOwner.query(
    `DELETE FROM public.formulario WHERE id IN (${deEstaPrueba})`,
    [SOLICITUD, APTITUD],
  );
}

beforeAll(async () => {
  await resetBaseDePruebas();
  await borrarFormularios();
  await levantarServidor();
  directora = await sesionComo("DIRECTORA");
}, 60_000);

afterAll(async () => {
  await borrarFormularios();
  await bajarServidor();
  await cerrarPools();
});

describe("sección de un campo, por la API", () => {
  it("se guarda al agregar, se conserva si no se manda y se quita con null", async () => {
    const formulario = await pedir("POST", "/api/formularios", directora, {
      nombre: "Prueba secciones API",
    });
    expect(formulario.status).toBe(201);
    const id = formulario.cuerpo.id;

    const campo = await pedir("POST", `/api/formularios/${id}/campos`, directora, {
      etiqueta: "Notas",
      tipo_dato_id: await idCatalogo("tipo_dato_campo_formulario", "TEXTO_LARGO"),
      orden: 1,
      seccion: "Hoja 2 · Aptitud",
    });
    expect(campo.status).toBe(201);
    expect(campo.cuerpo.seccion).toBe("Hoja 2 · Aptitud");

    // Editar otra cosa no borra la sección
    await pedir("PATCH", `/api/formularios/campos/${campo.cuerpo.id}`, directora, {
      etiqueta: "Notas del evaluador",
    });
    let leido = await pedir("GET", `/api/formularios/${id}`, directora);
    expect(leido.cuerpo.campos[0].seccion).toBe("Hoja 2 · Aptitud");

    await pedir("PATCH", `/api/formularios/campos/${campo.cuerpo.id}`, directora, {
      seccion: null,
    });
    leido = await pedir("GET", `/api/formularios/${id}`, directora);
    expect(leido.cuerpo.campos[0].seccion).toBeNull();
  });

  it("admite secciones de hasta 200 caracteres (migración 32)", async () => {
    const formulario = await pedir("POST", "/api/formularios", directora, {
      nombre: "Prueba secciones largo",
    });
    const campos = `/api/formularios/${formulario.cuerpo.id}/campos`;
    const tipo = await idCatalogo("tipo_dato_campo_formulario", "TEXTO_CORTO");

    const justo = await pedir("POST", campos, directora, {
      etiqueta: "Campo", tipo_dato_id: tipo, orden: 1, seccion: "S".repeat(200),
    });
    expect(justo.status).toBe(201);
    expect(justo.cuerpo.seccion).toHaveLength(200);

    const largo = await pedir("POST", campos, directora, {
      etiqueta: "Otro", tipo_dato_id: tipo, orden: 2, seccion: "S".repeat(201),
    });
    expect(largo.status).toBe(400);
  });
});

describe("migración 31: la aptitud pasa a ser la hoja 2", () => {
  it("mueve campos y respuestas, completa solo si ambas hojas lo estaban, y desactiva la aptitud", async () => {
    const u = directora.usuarioId;
    const tipoTexto = await idCatalogo("tipo_dato_campo_formulario", "TEXTO_CORTO");
    const tipoNumero = await idCatalogo("tipo_dato_campo_formulario", "NUMERO");

    const nuevo = async (nombre: string) =>
      (
        await poolOwner.query<{ id: number }>(
          `INSERT INTO public.formulario (nombre, created_by) VALUES ($1, $2) RETURNING id`,
          [nombre, u],
        )
      ).rows[0].id;
    const sol = await nuevo(SOLICITUD);
    const apt = await nuevo(APTITUD);

    const campo = async (formulario: number, etiqueta: string, tipo: number, orden: number) =>
      (
        await poolOwner.query<{ id: number }>(
          `INSERT INTO public.formulario_campo (formulario_id, etiqueta, tipo_dato_id, orden)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [formulario, etiqueta, tipo, orden],
        )
      ).rows[0].id;
    await campo(sol, "Diagnóstico", tipoTexto, 1);
    await campo(sol, "Cuál es su experiencia con el uso de una silla de ruedas", tipoTexto, 2);
    const cadera = await campo(apt, "Ancho de la cadera (cm)", tipoNumero, 1);

    // Dos líneas: una con las dos hojas llenas, otra solo con la aptitud
    // Una línea por insumo: la misma solicitud no repite insumo
    const insumoA = await crearInsumo(u);
    const insumoB = await crearInsumo(u);
    const persona = await crearPersona(u, { nombres: "Hoja Dos" });
    const programa = (
      await poolOwner.query<{ id: number }>(
        `INSERT INTO public.programa (nombre, created_by) VALUES ('Programa secciones', $1)
         ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
        [u],
      )
    ).rows[0].id;
    const solicitud = (
      await poolOwner.query<{ id: number }>(
        `INSERT INTO public.solicitud_apoyo (persona_id, programa_id, estado_id, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [persona, programa, await idCatalogo("estado_solicitud_apoyo", "PENDIENTE_ADQUISICION"), u],
      )
    ).rows[0].id;
    const linea = async (insumoId: number) =>
      (
        await poolOwner.query<{ id: number }>(
          `INSERT INTO public.detalle_solicitud_apoyo
             (solicitud_id, insumo_id, cantidad_requerida, estado_id, modalidad_solicitud_id, created_by)
           VALUES ($1, $2, 1, 1, $3, $4) RETURNING id`,
          [solicitud, insumoId, await idCatalogo("modalidad_solicitud", "DONACION"), u],
        )
      ).rows[0].id;
    const lineaAmbas = await linea(insumoA.insumoId);
    const lineaSoloAptitud = await linea(insumoB.insumoId);

    const dsf = async (lineaId: number, formulario: number, completado: boolean) =>
      (
        await poolOwner.query<{ id: number }>(
          `INSERT INTO public.detalle_solicitud_formulario (detalle_solicitud_id, formulario_id, completado)
           VALUES ($1, $2, $3) RETURNING id`,
          [lineaId, formulario, completado],
        )
      ).rows[0].id;
    const hoja1 = await dsf(lineaAmbas, sol, true);
    const aptAmbas = await dsf(lineaAmbas, apt, true);
    const aptSola = await dsf(lineaSoloAptitud, apt, true);
    for (const [d, valor] of [[aptAmbas, "35"], [aptSola, "40"]] as const) {
      await poolOwner.query(
        `INSERT INTO public.detalle_solicitud_formulario_respuesta
           (detalle_solicitud_formulario_id, formulario_campo_id, valor_texto)
         VALUES ($1, $2, $3)`,
        [d, cadera, valor],
      );
    }

    await poolOwner.query(MIGRACION);
    // Idempotente: una segunda corrida no cambia nada ni falla
    await poolOwner.query(MIGRACION);

    const { rows: campos } = await poolOwner.query(
      `SELECT etiqueta, orden, seccion FROM public.formulario_campo
       WHERE formulario_id = $1 ORDER BY orden`,
      [sol],
    );
    // El orden es la posición en la lista del papel: los huecos son campos
    // del papel que esta base de prueba no tiene
    expect(campos).toEqual([
      { etiqueta: "Diagnóstico", orden: 2, seccion: "Estado físico y consideraciones" },
      {
        etiqueta: "Experiencia de la persona con el uso de una silla de ruedas",
        orden: 6,
        seccion: "Estado físico y consideraciones",
      },
      { etiqueta: "Notas", orden: 10, seccion: "Estado físico y consideraciones" },
      {
        etiqueta: "Ancho de la cadera (cm)",
        orden: 15,
        seccion: "Hoja 2 · Formulario de aptitud para silla de ruedas",
      },
    ]);

    const { rows: hojas } = await poolOwner.query(
      `SELECT d.detalle_solicitud_id AS linea, d.completado, r.valor_texto AS cadera
       FROM public.detalle_solicitud_formulario d
       JOIN public.detalle_solicitud_formulario_respuesta r
         ON r.detalle_solicitud_formulario_id = d.id
       WHERE d.formulario_id = $1 AND d.activo
       ORDER BY d.detalle_solicitud_id`,
      [sol],
    );
    expect(hojas).toEqual([
      { linea: lineaAmbas, completado: true, cadera: "35" },
      // La hoja 1 nunca se llenó: el formulario unido queda pendiente
      { linea: lineaSoloAptitud, completado: false, cadera: "40" },
    ]);
    expect(
      (await poolOwner.query(`SELECT id FROM public.detalle_solicitud_formulario WHERE detalle_solicitud_id = $1 AND formulario_id = $2`, [lineaAmbas, sol])).rows[0].id,
    ).toBe(hoja1);

    const { rows: aptitud } = await poolOwner.query(
      `SELECT f.activo,
              (SELECT count(*)::int FROM public.detalle_solicitud_formulario d
               WHERE d.formulario_id = f.id AND d.activo) AS hojas_activas
       FROM public.formulario f WHERE f.id = $1`,
      [apt],
    );
    expect(aptitud[0]).toEqual({ activo: false, hojas_activas: 0 });
  });
});

describe("expediente: bloques en el orden del papel", () => {
  const r = (
    campo_id: number,
    etiqueta: string,
    seccion: string | null,
    grupo: string | null = null,
    numero_fila: number | null = null,
    valor: string | null = null,
  ): RespuestaExpediente => ({
    campo_id,
    etiqueta,
    seccion,
    grupo_repetible: grupo,
    orden: campo_id,
    numero_fila,
    valor,
  });

  it("pone el título al cambiar de sección y cada grupo donde está su primer campo", () => {
    const bloques = bloquesDeFormulario([
      r(1, "Registro médico", "I. Datos generales"),
      r(2, "Quién aporta", "II. Ingresos", "ingresos", 1, "Ana"),
      r(3, "Ingreso mensual (Q)", "II. Ingresos", "ingresos", 1, "1,500"),
      r(2, "Quién aporta", "II. Ingresos", "ingresos", 2, "Luis"),
      r(3, "Ingreso mensual (Q)", "II. Ingresos", "ingresos", 2, "800.50"),
      r(4, "Tipo de vivienda", "III. Vivienda"),
    ]);

    expect(bloques.map((b) => (b.tipo === "seccion" ? "#" + b.titulo : b.tipo === "dato" ? b.etiqueta : "[" + b.nombre + "]"))).toEqual([
      "#I. Datos generales",
      "Registro médico",
      "#II. Ingresos",
      "[ingresos]",
      "#III. Vivienda",
      "Tipo de vivienda",
    ]);

    const grupo = bloques.find((b) => b.tipo === "grupo")!;
    if (grupo.tipo !== "grupo") throw new Error();
    expect(totalDeGrupo(grupo.campos, grupo.filas)).toBe(2300.5);
  });
});
