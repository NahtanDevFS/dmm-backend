import { pool } from "../../db/pool.js";

/** Consultas de agregados para las gráficas de Inicio */

export interface EntregasPorMes {
  mes: string; // primer día del mes, ISO (YYYY-MM-DD)
  total_entregas: number;
}

/** Entregas activas por mes, ventana fija de los últimos `meses` meses(incluye el actual) */
export async function entregasPorMes(meses: number): Promise<EntregasPorMes[]> {
  const result = await pool.query<EntregasPorMes>(
    `SELECT to_char(serie.mes, 'YYYY-MM-DD') AS mes,
            COALESCE(count(e.id), 0)::int AS total_entregas
     FROM generate_series(
            date_trunc('month', CURRENT_DATE) - ($1::int - 1) * interval '1 month',
            date_trunc('month', CURRENT_DATE),
            interval '1 month'
          ) AS serie(mes)
     LEFT JOIN public.entrega e
       ON e.activo = true
      AND date_trunc('month', e.fecha_entrega) = serie.mes
     GROUP BY serie.mes
     ORDER BY serie.mes`,
    [meses],
  );
  return result.rows;
}

export interface StockPorCategoria {
  categoria_nombre: string;
  unidades_totales_disponibles: number;
  lotes_urgentes_o_vencidos: number;
}

/** Mismo origen que el reporte "Stock por categoría", sin filtros */
export async function stockPorCategoria(): Promise<StockPorCategoria[]> {
  const result = await pool.query<StockPorCategoria>(
    `SELECT categoria_nombre, unidades_totales_disponibles, lotes_urgentes_o_vencidos
     FROM public.v_reporte_stock_por_categoria
     ORDER BY unidades_totales_disponibles DESC`,
  );
  return result.rows;
}

export interface PoblacionPorPrograma {
  programa_nombre: string;
  personas_unicas_beneficiadas: number;
}

/** Población beneficiada agregada por programa, sumando los meses del rango */
export async function poblacionPorPrograma(
  desde: string,
  hasta: string,
): Promise<PoblacionPorPrograma[]> {
  const result = await pool.query<PoblacionPorPrograma>(
    `SELECT programa_nombre,
            SUM(personas_unicas_beneficiadas)::int AS personas_unicas_beneficiadas
     FROM public.v_reporte_poblacion_beneficiada
     WHERE mes >= date_trunc('month', $1::date)::date
       AND mes <= date_trunc('month', $2::date)::date
       AND programa_nombre IS NOT NULL
     GROUP BY programa_nombre
     ORDER BY personas_unicas_beneficiadas DESC`,
    [desde, hasta],
  );
  return result.rows;
}

export interface PoblacionPorGenero {
  genero: string;
  personas_unicas_beneficiadas: number;
}

/** Igual que poblacionPorPrograma pero agrupando por género en vez deprograma */
export async function poblacionPorGenero(
  desde: string,
  hasta: string,
): Promise<PoblacionPorGenero[]> {
  const result = await pool.query<PoblacionPorGenero>(
    `SELECT genero,
            SUM(personas_unicas_beneficiadas)::int AS personas_unicas_beneficiadas
     FROM public.v_reporte_poblacion_beneficiada
     WHERE mes >= date_trunc('month', $1::date)::date
       AND mes <= date_trunc('month', $2::date)::date
       AND genero IS NOT NULL
     GROUP BY genero
     ORDER BY personas_unicas_beneficiadas DESC`,
    [desde, hasta],
  );
  return result.rows;
}
