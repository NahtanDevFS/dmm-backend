import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";

type Fila = Record<string, unknown>;

/**
 * Acumulador de condiciones WHERE con parámetros posicionales. Evita repetir el
 * conteo manual de $1, $2... en cada reporte y garantiza que todo valor de la
 * petición viaje parametrizado (RNF-SEG-04).
 */
class Filtros {
  private condiciones: string[] = [];
  private valores: unknown[] = [];

  agregar(plantilla: (n: string) => string, valor: unknown): this {
    this.valores.push(valor);
    this.condiciones.push(plantilla(`$${this.valores.length}`));
    return this;
  }

  agregarSinValor(condicion: string): this {
    this.condiciones.push(condicion);
    return this;
  }

  get where(): string {
    return this.condiciones.length
      ? `WHERE ${this.condiciones.join(" AND ")}`
      : "";
  }

  get params(): unknown[] {
    return this.valores;
  }
}

// ─────────────────────────────────────────────── resolución de nombres

/**
 * `v_reporte_poblacion_beneficiada` está agregada y solo expone nombres. La
 * comunidad es única por (nombre, municipio_id), así que para filtrar de forma
 * exacta por id hace falta la pareja comunidad+municipio.
 */
export async function buscarComunidadParaFiltro(
  id: number,
): Promise<{ nombre: string; municipio_nombre: string } | null> {
  const result = await pool.query<{ nombre: string; municipio_nombre: string }>(
    `SELECT c.nombre, m.nombre AS municipio_nombre
     FROM public.comunidad c
     JOIN public.municipio m ON m.id = c.municipio_id
     WHERE c.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function buscarNombrePrograma(
  id: number,
): Promise<string | null> {
  const programa = await prisma.programa.findUnique({
    where: { id },
    select: { nombre: true },
  });
  return programa?.nombre ?? null;
}

export async function existeComunidad(id: number): Promise<boolean> {
  return (await buscarComunidadParaFiltro(id)) !== null;
}

export async function existeDiscapacidad(id: number): Promise<boolean> {
  const d = await prisma.discapacidad.findUnique({
    where: { id },
    select: { id: true },
  });
  return d !== null;
}

export async function existeCategoriaInsumo(id: number): Promise<boolean> {
  const c = await prisma.categoria_insumo.findUnique({
    where: { id },
    select: { id: true },
  });
  return c !== null;
}

// ─────────────────────────────────────────────── RF-REP-01/02/03/04

/**
 * Detalle de personas atendidas (una fila por renglón entregado).
 *
 * La vista ya resuelve la edad a la fecha de la entrega, la jerarquía
 * geográfica y las discapacidades concatenadas. Los filtros por comunidad y por
 * discapacidad se aplican con subconsultas sobre `persona_id` en vez de por
 * nombre: el nombre de una comunidad solo es único dentro de su municipio.
 */
export async function reportePersonasAtendidas(params: {
  desde?: string;
  hasta?: string;
  comunidadId?: number;
  discapacidadId?: number;
  programaNombre?: string;
  genero?: string;
  edadMin?: number;
  edadMax?: number;
  soloAdultoMayor: boolean;
  soloConDiscapacidad: boolean;
}): Promise<Fila[]> {
  const f = new Filtros();

  if (params.desde) f.agregar((n) => `fecha_entrega >= ${n}::date`, params.desde);
  if (params.hasta) f.agregar((n) => `fecha_entrega <= ${n}::date`, params.hasta);
  if (params.genero) f.agregar((n) => `genero = ${n}`, params.genero);
  if (params.programaNombre)
    f.agregar((n) => `programa_nombre = ${n}`, params.programaNombre);
  if (params.edadMin !== undefined)
    f.agregar((n) => `edad_a_la_entrega >= ${n}`, params.edadMin);
  if (params.edadMax !== undefined)
    f.agregar((n) => `edad_a_la_entrega <= ${n}`, params.edadMax);
  // 65 años es el umbral que usa fn_es_adulto_mayor en la base de datos.
  if (params.soloAdultoMayor) f.agregarSinValor(`edad_a_la_entrega >= 65`);
  if (params.soloConDiscapacidad) f.agregarSinValor(`discapacidades IS NOT NULL`);
  if (params.comunidadId !== undefined)
    f.agregar(
      (n) =>
        `persona_id IN (SELECT id FROM public.persona WHERE comunidad_id = ${n})`,
      params.comunidadId,
    );
  if (params.discapacidadId !== undefined)
    f.agregar(
      (n) =>
        `persona_id IN (SELECT persona_id FROM public.persona_discapacidad
                        WHERE discapacidad_id = ${n} AND activo = true)`,
      params.discapacidadId,
    );

  const result = await pool.query(
    `SELECT fecha_entrega, persona_nombre_completo, edad_a_la_entrega, genero,
            comunidad_nombre, municipio_nombre, programa_nombre, insumo_nombre,
            cantidad_entregada, unidad_despacho, discapacidades, usuario_entrega
     FROM public.v_reporte_personas_atendidas
     ${f.where}
     ORDER BY fecha_entrega DESC, persona_nombre_completo`,
    f.params,
  );
  return result.rows;
}

/** RF-REP-06: stock por categoría, con conteo de lotes urgentes o vencidos. */
export async function reporteStockPorCategoria(params: {
  categoriaId?: number;
  soloConUrgentes: boolean;
}): Promise<Fila[]> {
  const f = new Filtros();
  if (params.categoriaId !== undefined)
    f.agregar((n) => `categoria_id = ${n}`, params.categoriaId);
  if (params.soloConUrgentes)
    f.agregarSinValor(`lotes_urgentes_o_vencidos > 0`);

  const result = await pool.query(
    `SELECT categoria_nombre, cantidad_tipos_insumo,
            unidades_totales_disponibles, lotes_urgentes_o_vencidos
     FROM public.v_reporte_stock_por_categoria
     ${f.where}
     ORDER BY categoria_nombre`,
    f.params,
  );
  return result.rows;
}

/**
 * Población beneficiada, agregada por mes / geografía / programa / género /
 * grupo etario / discapacidad. El grupo etario lo clasifica la vista con
 * fn_es_adulto_mayor y fn_es_menor; aquí solo se filtra por el resultado.
 */
export async function reportePoblacionBeneficiada(params: {
  desde?: string;
  hasta?: string;
  comunidad?: { nombre: string; municipio_nombre: string };
  programaNombre?: string;
  genero?: string;
  grupoEtario?: string;
  soloConDiscapacidad: boolean;
}): Promise<Fila[]> {
  const f = new Filtros();

  // `mes` es el primer día del mes: se compara con date_trunc para que un
  // "desde" a mitad de mes incluya ese mes completo.
  if (params.desde)
    f.agregar(
      (n) => `mes >= date_trunc('month', ${n}::date)::date`,
      params.desde,
    );
  if (params.hasta)
    f.agregar(
      (n) => `mes <= date_trunc('month', ${n}::date)::date`,
      params.hasta,
    );
  if (params.genero) f.agregar((n) => `genero = ${n}`, params.genero);
  if (params.grupoEtario)
    f.agregar((n) => `grupo_etario = ${n}`, params.grupoEtario);
  if (params.programaNombre)
    f.agregar((n) => `programa_nombre = ${n}`, params.programaNombre);
  if (params.soloConDiscapacidad)
    f.agregarSinValor(`tiene_discapacidad = true`);
  if (params.comunidad) {
    f.agregar((n) => `comunidad_nombre = ${n}`, params.comunidad.nombre);
    f.agregar(
      (n) => `municipio_nombre = ${n}`,
      params.comunidad.municipio_nombre,
    );
  }

  const result = await pool.query(
    `SELECT mes, departamento_nombre, municipio_nombre, comunidad_nombre,
            programa_nombre, genero, grupo_etario, tiene_discapacidad,
            personas_unicas_beneficiadas, total_entregas
     FROM public.v_reporte_poblacion_beneficiada
     ${f.where}
     ORDER BY mes DESC, comunidad_nombre, programa_nombre`,
    f.params,
  );
  return result.rows;
}
