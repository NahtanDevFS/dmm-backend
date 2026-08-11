import { Pool } from "pg";

/**
 * Dos conexiones a la base de PRUEBAS, a proposito:
 *
 *  - `poolApp` usa el mismo rol de minimo privilegio que la aplicacion en
 *    produccion (dmm_app). Todo lo que ejerce el codigo bajo prueba pasa por
 *    aqui, de modo que cualquier GRANT que falte aparece como test roto y no
 *    como error en produccion.
 *
 *  - `poolOwner` usa el dueno del esquema y existe SOLO para preparar y limpiar.
 *    Es necesario porque desde la migracion 12 la aplicacion no puede borrar
 *    nada: no hay DELETE en ninguna tabla y auditoria_log es de solo lectura.
 *    Sin un rol privilegiado no habria forma de dejar la base en un estado
 *    conocido entre pruebas.
 */

const urlApp = process.env.DATABASE_URL_TEST;
const urlOwner = process.env.DATABASE_URL_TEST_OWNER;

if (!urlApp || !urlOwner) {
  throw new Error(
    "Faltan DATABASE_URL_TEST y/o DATABASE_URL_TEST_OWNER en el .env. " +
      "Las pruebas NO deben correr contra la base de desarrollo.",
  );
}

/**
 * Salvaguarda contra el peor accidente posible de este archivo: que alguien
 * apunte DATABASE_URL_TEST a la base real y `resetBaseDePruebas()` la vacie.
 *
 * El nombre de la base debe contener "test". Es una convencion, pero es la
 * unica senal disponible antes de conectar, y el costo de equivocarse es
 * perder los datos de la DMM.
 */
function exigirBaseDePruebas(url: string, variable: string): void {
  const nombre = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(nombre)) {
    throw new Error(
      `${variable} apunta a la base "${nombre}", que no parece de pruebas.\n` +
        "Las pruebas vacian tablas: apunte a una base cuyo nombre contenga 'test'.",
    );
  }
}

exigirBaseDePruebas(urlApp, "DATABASE_URL_TEST");
exigirBaseDePruebas(urlOwner, "DATABASE_URL_TEST_OWNER");

export const poolApp = new Pool({ connectionString: urlApp });
export const poolOwner = new Pool({ connectionString: urlOwner });

/**
 * Tablas que se vacian entre suites.
 *
 * `usuario` NO esta en la lista, y es la parte importante de este archivo.
 *
 * Las 76 claves foraneas `created_by`/`updated_by` de todo el esquema apuntan a
 * `usuario`. Como TRUNCATE ... CASCADE se propaga hacia las tablas que
 * REFERENCIAN a la truncada, incluir `usuario` aqui vaciaba la base entera —
 * incluidos `rol`, `tipo_genero` y el resto de catalogos de sistema que las
 * pruebas necesitan y que el script del esquema siembra una sola vez.
 *
 * Los usuarios de prueba se limpian aparte, por nombre, despues de vaciar todo
 * lo que pudiera referenciarlos.
 */
const TABLAS_A_VACIAR = [
  "auditoria_log",
  "sesion",
  "multa_prestamo",
  "contrato_prestamo",
  "evidencia_entrega",
  "detalle_entrega",
  "entrega",
  "receta_medica",
  "detalle_solicitud_apoyo",
  "solicitud_apoyo",
  "detalle_inventario_lote",
  "documento_recepcion",
  "recepcion_donacion_lote",
  "presentacion_insumo",
  "insumo",
  "marca_insumo",
  "categoria_insumo",
  "unidad_medida",
  "institucion_donante",
  "documento_persona",
  "contacto_referencia_persona",
  "encargado_menor",
  "persona_discapacidad",
  "persona",
  "discapacidad",
  "programa",
  "comunidad",
  "municipio",
  "departamento",
];

/**
 * Catalogos de sistema con valores fijos. Se resiembran de forma idempotente
 * para que la base de pruebas quede completamente definida por este archivo:
 * asi se recupera sola si alguien la vacia, y no hay que ir a buscar el script
 * de 3800 lineas del esquema.
 *
 * Deben coincidir con las semillas del script v3. Si alli se agrega un valor,
 * agreguelo aqui tambien.
 *
 * EL ORDEN IMPORTA, y no es cosmetico: `tipo_accion_auditoria` va primero
 * porque cada tabla auditada tiene un trigger AFTER INSERT que llama a
 * `fn_auditoria`, y esa funcion resuelve `tipo_accion_id` buscando TG_OP
 * ('INSERT'/'UPDATE'/'DELETE') en ese catalogo. Si esta vacio, el SELECT
 * devuelve NULL y la insercion falla con una violacion de NOT NULL sobre
 * `auditoria_log.tipo_accion_id`. Es decir: sin ese catalogo, NINGUNA
 * escritura del sistema funciona.
 */
const SEMILLAS: Array<{ tabla: string; columnas: string; filas: string }> = [
  {
    tabla: "tipo_accion_auditoria",
    columnas: "nombre",
    filas: `('INSERT'), ('UPDATE'), ('DELETE')`,
  },
  {
    tabla: "rol",
    columnas: "nombre, descripcion",
    filas: `('EMPLEADO_DMM', 'Operacion diaria: beneficiarios, solicitudes, inventario, entregas.'),
            ('DIRECTORA', 'Permisos equivalentes a Administrador, incluida gestion de catalogos.'),
            ('ALCALDE', 'Acceso exclusivo de solo lectura al modulo de reportes.'),
            ('ADMINISTRADOR', 'Gestion de usuarios, configuracion y catalogos.')`,
  },
  {
    tabla: "estado_solicitud_apoyo",
    columnas: "nombre",
    filas: `('PENDIENTE_ADQUISICION'), ('PENDIENTE_ENTREGA'),
            ('PENDIENTE_ENTREGA_PARCIAL'), ('APROBADA'), ('RECHAZADA'),
            ('ENTREGADA'), ('CANCELADA')`,
  },
  {
    tabla: "estado_contrato_prestamo",
    columnas: "nombre",
    filas: `('VIGENTE'), ('DEVUELTO'), ('VENCIDO'), ('EXTENDIDO')`,
  },
  {
    tabla: "tipo_genero",
    columnas: "nombre",
    filas: `('MASCULINO'), ('FEMENINO'), ('OTRO'), ('PREFIERE_NO_DECIR')`,
  },
  {
    tabla: "tipo_parentesco",
    columnas: "nombre",
    filas: `('MADRE'), ('PADRE'), ('HIJO_A'), ('HERMANO_A'), ('ABUELO_A'),
            ('TIO_A'), ('CONYUGE'), ('OTRO')`,
  },
  {
    tabla: "tipo_documento_persona",
    columnas: "nombre",
    filas: `('DPI'), ('PARTIDA_NACIMIENTO'), ('DPI_ENCARGADO'), ('OTRO')`,
  },
  {
    tabla: "tipo_evidencia_entrega",
    columnas: "nombre",
    filas: `('FOTO_BENEFICIARIO_CON_INSUMO'), ('FOTO_RECEPTOR'),
            ('FOTOCOPIA_DPI_RECEPTOR'), ('OTRO')`,
  },
  {
    tabla: "tipo_multa_prestamo",
    columnas: "nombre, monto_sugerido",
    filas: `('RETRASO_DEVOLUCION', 50.00), ('EQUIPO_DANADO', 100.00)`,
  },
];

/** Repone los catalogos de sistema que falten. Idempotente. */
export async function sembrarCatalogosDeSistema(): Promise<void> {
  for (const { tabla, columnas, filas } of SEMILLAS) {
    // Ver la nota sobre el orden en SEMILLAS: si este catalogo se quedo vacio,
    // el error real seria una violacion de NOT NULL en auditoria_log, que no
    // dice nada sobre la causa.
    if (tabla !== "tipo_accion_auditoria") {
      const { rows } = await poolOwner.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.tipo_accion_auditoria`,
      );
      if (Number(rows[0].n) === 0) {
        throw new Error(
          "public.tipo_accion_auditoria esta vacia. Los triggers de auditoria " +
            "no pueden resolver tipo_accion_id y toda escritura fallara. " +
            "Siembre ese catalogo antes que cualquier otro.",
        );
      }
    }
    const primeraColumna = columnas.split(",")[0].trim();
    await poolOwner.query(
      `INSERT INTO public.${tabla} (${columnas})
       SELECT * FROM (VALUES ${filas}) AS nuevos(${columnas})
       WHERE NOT EXISTS (
         SELECT 1 FROM public.${tabla} t WHERE t.${primeraColumna} = nuevos.${primeraColumna}
       )`,
    );
  }
}

export async function resetBaseDePruebas(): Promise<void> {
  await poolOwner.query(
    `TRUNCATE TABLE ${TABLAS_A_VACIAR.map((t) => `public.${t}`).join(", ")}
     RESTART IDENTITY CASCADE`,
  );

  // Se siembra ANTES del DELETE de usuarios, no despues: ese DELETE dispara
  // trg_auditoria_usuario con TG_OP = 'DELETE', y fn_auditoria necesita que
  // tipo_accion_auditoria ya tenga sus filas para resolver tipo_accion_id.
  await sembrarCatalogosDeSistema();

  // Despues del TRUNCATE ya no queda nada que referencie a estos usuarios.
  await poolOwner.query(
    `DELETE FROM public.usuario WHERE username LIKE 'test\\_%' ESCAPE '\\'`,
  );

  // Guarda contra la clase de error que ya fallo dos veces en este helper:
  // catalogos de sistema que desaparecen por CASCADE o que se siembran tarde.
  const { rows } = await poolOwner.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.rol`,
  );
  if (Number(rows[0].n) < 4) {
    throw new Error(
      "Tras el reset, public.rol tiene menos de 4 filas. Algun TRUNCATE se " +
        "esta llevando los catalogos de sistema por CASCADE.",
    );
  }
}

export async function cerrarPools(): Promise<void> {
  await Promise.all([poolApp.end(), poolOwner.end()]);
}

/** Ids de los catalogos de sistema, resueltos por nombre. */
export async function idCatalogo(
  tabla: string,
  nombre: string,
): Promise<number> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `SELECT id FROM public.${tabla} WHERE nombre = $1`,
    [nombre],
  );
  if (!rows[0]) {
    throw new Error(
      `No existe ${tabla}.nombre = '${nombre}'. ` +
        "¿Se creo dmm_test con el script del esquema v3 y sus semillas?",
    );
  }
  return rows[0].id;
}
