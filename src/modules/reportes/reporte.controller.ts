import type { Request, Response, NextFunction } from "express";
import {
  personasAtendidasQuerySchema,
  stockPorCategoriaQuerySchema,
  poblacionBeneficiadaQuerySchema,
} from "./reporte.schema.js";
import {
  reportePersonasAtendidas,
  reporteStockPorCategoria,
  reportePoblacionBeneficiada,
  buscarComunidadParaFiltro,
  buscarNombrePrograma,
  existeDiscapacidad,
  existeCategoriaInsumo,
} from "./reporte.repository.js";
import {
  responderExcel,
  responderPdf,
  type ColumnaReporte,
  type FormatoReporte,
} from "../../lib/reportes/exportar.js";

/**
 * Entrega el reporte en el formato pedido. El JSON incluye los filtros
 * aplicados para que el frontend pueda mostrarlos junto a la tabla; en Excel y
 * PDF esa misma descripción va en el subtítulo del documento.
 */
async function responder(
  res: Response,
  formato: FormatoReporte,
  titulo: string,
  columnas: ColumnaReporte[],
  filas: Record<string, unknown>[],
  filtrosAplicados: Record<string, unknown>,
): Promise<void> {
  if (formato === "xlsx") {
    return responderExcel(res, titulo, columnas, filas);
  }
  if (formato === "pdf") {
    return responderPdf(res, titulo, columnas, filas, describir(filtrosAplicados));
  }
  res.status(200).json({
    titulo,
    generado_en: new Date().toISOString(),
    filtros: filtrosAplicados,
    total_registros: filas.length,
    columnas,
    datos: filas,
  });
}

function describir(filtros: Record<string, unknown>): string {
  const partes = Object.entries(filtros)
    .filter(([, v]) => v !== undefined && v !== false && v !== null)
    .map(([k, v]) => `${k}: ${v}`);
  return partes.length ? `Filtros — ${partes.join(" · ")}` : "Sin filtros";
}

// ─────────────────────────────────────────────── personas atendidas

const COLUMNAS_PERSONAS: ColumnaReporte[] = [
  { campo: "fecha_entrega", titulo: "Fecha", ancho: 11 },
  { campo: "persona_nombre_completo", titulo: "Beneficiario", ancho: 26 },
  { campo: "edad_a_la_entrega", titulo: "Edad", ancho: 7 },
  { campo: "genero", titulo: "Género", ancho: 14 },
  { campo: "comunidad_nombre", titulo: "Comunidad", ancho: 20 },
  { campo: "municipio_nombre", titulo: "Municipio", ancho: 16 },
  { campo: "programa_nombre", titulo: "Programa", ancho: 20 },
  { campo: "insumo_nombre", titulo: "Insumo", ancho: 24 },
  { campo: "cantidad_entregada", titulo: "Cantidad", ancho: 10 },
  { campo: "unidad_despacho", titulo: "Unidad", ancho: 12 },
  { campo: "discapacidades", titulo: "Discapacidades", ancho: 24 },
  { campo: "usuario_entrega", titulo: "Entregó", ancho: 13 },
];

export async function personasAtendidasController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = personasAtendidasQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de reporte inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const d = parsed.data;

    if (
      d.edadMin !== undefined &&
      d.edadMax !== undefined &&
      d.edadMin > d.edadMax
    ) {
      return res.status(400).json({
        message: "La edad mínima no puede ser mayor que la edad máxima",
      });
    }
    if (d.desde && d.hasta && d.desde > d.hasta) {
      return res.status(400).json({
        message: "La fecha 'desde' no puede ser posterior a la fecha 'hasta'",
      });
    }

    let comunidadNombre: string | undefined;
    if (d.comunidadId !== undefined) {
      const comunidad = await buscarComunidadParaFiltro(d.comunidadId);
      if (!comunidad) {
        return res
          .status(400)
          .json({ message: "La comunidad indicada no existe" });
      }
      comunidadNombre = comunidad.nombre;
    }

    if (
      d.discapacidadId !== undefined &&
      !(await existeDiscapacidad(d.discapacidadId))
    ) {
      return res
        .status(400)
        .json({ message: "La discapacidad indicada no existe" });
    }

    let programaNombre: string | undefined;
    if (d.programaId !== undefined) {
      const nombre = await buscarNombrePrograma(d.programaId);
      if (!nombre) {
        return res
          .status(400)
          .json({ message: "El programa indicado no existe" });
      }
      programaNombre = nombre;
    }

    const filas = await reportePersonasAtendidas({
      desde: d.desde,
      hasta: d.hasta,
      comunidadId: d.comunidadId,
      discapacidadId: d.discapacidadId,
      programaNombre,
      genero: d.genero,
      edadMin: d.edadMin,
      edadMax: d.edadMax,
      soloAdultoMayor: d.soloAdultoMayor,
      soloConDiscapacidad: d.soloConDiscapacidad,
    });

    return responder(
      res,
      d.formato,
      "Personas atendidas",
      COLUMNAS_PERSONAS,
      filas,
      {
        desde: d.desde,
        hasta: d.hasta,
        comunidad: comunidadNombre,
        programa: programaNombre,
        genero: d.genero,
        edadMin: d.edadMin,
        edadMax: d.edadMax,
        soloAdultoMayor: d.soloAdultoMayor || undefined,
        soloConDiscapacidad: d.soloConDiscapacidad || undefined,
      },
    );
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── stock por categoría

const COLUMNAS_STOCK: ColumnaReporte[] = [
  { campo: "categoria_nombre", titulo: "Categoría", ancho: 30 },
  { campo: "cantidad_tipos_insumo", titulo: "Tipos de insumo", ancho: 16 },
  {
    campo: "unidades_totales_disponibles",
    titulo: "Unidades disponibles",
    ancho: 20,
  },
  {
    campo: "lotes_urgentes_o_vencidos",
    titulo: "Lotes urgentes o vencidos",
    ancho: 24,
  },
];

export async function stockPorCategoriaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = stockPorCategoriaQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de reporte inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const d = parsed.data;

    if (
      d.categoriaId !== undefined &&
      !(await existeCategoriaInsumo(d.categoriaId))
    ) {
      return res
        .status(400)
        .json({ message: "La categoría indicada no existe" });
    }

    const filas = await reporteStockPorCategoria({
      categoriaId: d.categoriaId,
      soloConUrgentes: d.soloConUrgentes,
    });

    return responder(
      res,
      d.formato,
      "Stock por categoría",
      COLUMNAS_STOCK,
      filas,
      {
        categoriaId: d.categoriaId,
        soloConUrgentes: d.soloConUrgentes || undefined,
      },
    );
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── población beneficiada

const COLUMNAS_POBLACION: ColumnaReporte[] = [
  { campo: "mes", titulo: "Mes", ancho: 11 },
  { campo: "departamento_nombre", titulo: "Departamento", ancho: 16 },
  { campo: "municipio_nombre", titulo: "Municipio", ancho: 16 },
  { campo: "comunidad_nombre", titulo: "Comunidad", ancho: 22 },
  { campo: "programa_nombre", titulo: "Programa", ancho: 22 },
  { campo: "genero", titulo: "Género", ancho: 15 },
  { campo: "grupo_etario", titulo: "Grupo etario", ancho: 15 },
  { campo: "tiene_discapacidad", titulo: "Discapacidad", ancho: 13 },
  {
    campo: "personas_unicas_beneficiadas",
    titulo: "Personas únicas",
    ancho: 16,
  },
  { campo: "total_entregas", titulo: "Entregas", ancho: 11 },
];

export async function poblacionBeneficiadaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = poblacionBeneficiadaQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de reporte inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const d = parsed.data;

    if (d.desde && d.hasta && d.desde > d.hasta) {
      return res.status(400).json({
        message: "La fecha 'desde' no puede ser posterior a la fecha 'hasta'",
      });
    }

    let comunidad: { nombre: string; municipio_nombre: string } | undefined;
    if (d.comunidadId !== undefined) {
      const encontrada = await buscarComunidadParaFiltro(d.comunidadId);
      if (!encontrada) {
        return res
          .status(400)
          .json({ message: "La comunidad indicada no existe" });
      }
      comunidad = encontrada;
    }

    let programaNombre: string | undefined;
    if (d.programaId !== undefined) {
      const nombre = await buscarNombrePrograma(d.programaId);
      if (!nombre) {
        return res
          .status(400)
          .json({ message: "El programa indicado no existe" });
      }
      programaNombre = nombre;
    }

    const filas = await reportePoblacionBeneficiada({
      desde: d.desde,
      hasta: d.hasta,
      comunidad,
      programaNombre,
      genero: d.genero,
      grupoEtario: d.grupoEtario,
      soloConDiscapacidad: d.soloConDiscapacidad,
    });

    return responder(
      res,
      d.formato,
      "Población beneficiada",
      COLUMNAS_POBLACION,
      filas,
      {
        desde: d.desde,
        hasta: d.hasta,
        comunidad: comunidad?.nombre,
        programa: programaNombre,
        genero: d.genero,
        grupoEtario: d.grupoEtario,
        soloConDiscapacidad: d.soloConDiscapacidad || undefined,
      },
    );
  } catch (error) {
    return next(error);
  }
}
