import type { Response } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { etiquetaDe, esColumnaDeCatalogo } from "../etiquetas.js";

/** Exportación de reportes a Excel y PDF (RF-REP-05) */

export type FormatoReporte = "json" | "xlsx" | "pdf";

export interface ColumnaReporte {
  /** Clave en las filas devueltas por la consulta */
  campo: string;
  /** Encabezado legible para el usuario */
  titulo: string;
  /** Ancho relativo; se usa tanto en Excel como en el PDF */
  ancho?: number;
}

type Fila = Record<string, unknown>;

/** Columnas que agrupan por mes: su DATE es el primer día del mes */
function esColumnaDeMes(campo: string): boolean {
  return campo === "mes";
}

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * Fecha como se escribe en Guatemala: 29/09/2026, o 09/2026 si es un mes.
 *
 * Las columnas son DATE y node-postgres las entrega como medianoche LOCAL de
 * ese día. Por eso se leen con los getters locales: toISOString pasaba a UTC y,
 * con el servidor en un huso al este de Greenwich, mostraba el día anterior.
 */
function formatearFecha(fecha: Date, campo: string): string {
  const mes = dosDigitos(fecha.getMonth() + 1);
  if (esColumnaDeMes(campo)) return `${mes}/${fecha.getFullYear()}`;
  return `${dosDigitos(fecha.getDate())}/${mes}/${fecha.getFullYear()}`;
}

/** Texto de una celda del PDF. Exportada para probarla: el texto del PDF va comprimido */
export function formatearValor(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return formatearFecha(valor, campo);
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "string" && esColumnaDeCatalogo(campo)) {
    return etiquetaDe(valor);
  }
  return String(valor);
}

function nombreArchivo(titulo: string, extension: string): string {
  const base = titulo
    .toLowerCase()
// NFD separa la letra de su acento y el filtro siguiente descarta el acento,así "población" queda "poblacion" y no "poblaci-n"
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const fecha = new Date().toISOString().slice(0, 10);
  return `${base}-${fecha}.${extension}`;
}

export async function responderExcel(
  res: Response,
  titulo: string,
  columnas: ColumnaReporte[],
  filas: Fila[],
): Promise<void> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Sistema DMM Usumatlán";
  libro.created = new Date();

// El nombre de una hoja de Excel no admite : \ / ? * [ ] y va hasta 31 chars
  const hoja = libro.addWorksheet(titulo.replace(/[:\\/?*[\]]/g, "").slice(0, 31));

  hoja.columns = columnas.map((c) => ({
    header: c.titulo,
    key: c.campo,
    width: c.ancho ?? 18,
  }));

  hoja.getRow(1).font = { bold: true };
  hoja.getRow(1).alignment = { vertical: "middle" };

  for (const fila of filas) {
    hoja.addRow(
      Object.fromEntries(
        columnas.map((c) => [c.campo, normalizarParaExcel(c.campo, fila[c.campo])]),
      ),
    );
  }

  hoja.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columnas.length },
  };

// Los DATE de Postgres llegan como Date de JS y Excel los mostraría con hora y zona horaria
  columnas.forEach((c, indice) => {
    const primerValor = filas.find((f) => f[c.campo] != null)?.[c.campo];
    if (primerValor instanceof Date) {
      hoja.getColumn(indice + 1).numFmt = esColumnaDeMes(c.campo)
        ? "mm/yyyy"
        : "dd/mm/yyyy";
    }
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${nombreArchivo(titulo, "xlsx")}"`,
  );

  await libro.xlsx.write(res);
  res.end();
}

/** Los NUMERIC de Postgres llegan como string para no perder precisión */
function normalizarParaExcel(campo: string, valor: unknown): unknown {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) {
    // exceljs convierte el Date a la fecha de Excel en UTC: se fija el mismo
    // día del calendario a medianoche UTC para que no cambie según el huso
    // horario del servidor (ver formatearFecha)
    return new Date(Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate()));
  }
  if (typeof valor === "string" && valor !== "" && !Number.isNaN(Number(valor))) {
    return Number(valor);
  }
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "string" && esColumnaDeCatalogo(campo)) {
    return etiquetaDe(valor);
  }
  return valor;
}

/* ── PDF ─────────────────────────────────────────────────────────────────── */

const TINTA = "#241C20";
const GRIS = "#5F5358";
const LINEA = "#D9CFD4";
const FONDO_ENCABEZADO = "#F3ECEF";
const FRANJA = "#FAF7F8";

/** Momento de generación en hora de Guatemala, sin depender del huso del servidor */
export function momentoDeGeneracion(fecha = new Date()): string {
  return fecha.toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ETIQUETAS_FILTRO: Record<string, string> = {
  desde: "Desde",
  hasta: "Hasta",
  comunidad: "Comunidad",
  programa: "Programa",
  discapacidad: "Discapacidad",
  categoria: "Categoría",
  genero: "Género",
  grupoEtario: "Grupo etario",
  edadMin: "Edad mínima",
  edadMax: "Edad máxima",
  soloAdultoMayor: "Solo adultos mayores",
  soloConDiscapacidad: "Solo personas con discapacidad",
  soloConUrgentes: "Solo categorías con lotes urgentes o vencidos",
};

/**
 * Los filtros como los lee una persona: «Desde: 01/09/2026 · Solo personas con
 * discapacidad». Antes salían las claves internas (`soloConDiscapacidad: true`)
 * y las fechas en formato ISO.
 */
export function describirFiltros(filtros: Record<string, unknown>): string {
  const partes = Object.entries(filtros)
    .filter(([, v]) => v !== undefined && v !== false && v !== null && v !== "")
    .map(([clave, valor]) => {
      const etiqueta = ETIQUETAS_FILTRO[clave] ?? clave;
      // Un interruptor encendido se nombra solo: «Solo adultos mayores: Sí» sobra
      if (valor === true) return etiqueta;
      const texto = String(valor);
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
      return `${etiqueta}: ${iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : etiquetaDe(texto)}`;
    });
  return partes.length
    ? `Filtros: ${partes.join(" · ")}`
    : "Sin filtros: todos los registros";
}

export function responderPdf(
  res: Response,
  titulo: string,
  columnas: ColumnaReporte[],
  filas: Fila[],
  subtitulo?: string,
): void {
  // Landscape: los reportes son anchos y en vertical no caben las columnas.
  // bufferPages deja volver a cada página al final para escribir «Página X de Y».
  const doc = new PDFDocument({
    size: "LETTER",
    layout: "landscape",
    margin: 36,
    bufferPages: true,
    info: { Title: titulo, Author: "Sistema DMM Usumatlán" },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${nombreArchivo(titulo, "pdf")}"`,
  );
  doc.pipe(res);

  const izquierda = doc.page.margins.left;
  const ancho = doc.page.width - izquierda - doc.page.margins.right;

  doc
    .fillColor(TINTA)
    .fontSize(15)
    .font("Helvetica-Bold")
    .text("Dirección Municipal de la Mujer", izquierda, doc.page.margins.top);
  doc.fontSize(10).font("Helvetica").fillColor(GRIS).text("Usumatlán, Zacapa");
  doc.moveDown(0.6);
  doc.fillColor(TINTA).fontSize(13).font("Helvetica-Bold").text(titulo);
  doc.moveDown(0.15);
  if (subtitulo) {
    doc.fontSize(9).font("Helvetica").fillColor(GRIS).text(subtitulo, { width: ancho });
  }
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor(GRIS)
    .text(
      `Generado el ${momentoDeGeneracion()} · ${filas.length} registro${filas.length === 1 ? "" : "s"}`,
    );
  doc.moveDown(0.6);

  if (filas.length === 0) {
    doc
      .fillColor(TINTA)
      .fontSize(10)
      .font("Helvetica-Oblique")
      .text("No hay datos para los filtros seleccionados.");
  } else {
    escribirTablaPdf(doc, columnas, filas);
  }

  numerarPaginas(doc, `Dirección Municipal de la Mujer · ${titulo}`);
  doc.end();
}

/**
 * Pie de cada página: «… · Página X de Y». Va dentro del margen inferior, así
 * que se anula un momento: si no, pdfkit cree que el texto no cabe y abre otra
 * página en blanco. Requiere el documento creado con `bufferPages: true`.
 */
export function numerarPaginas(doc: PDFKit.PDFDocument, rotulo: string): void {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const izquierda = doc.page.margins.left;
    const ancho = doc.page.width - izquierda - doc.page.margins.right;
    doc
      .fontSize(7.5)
      .font("Helvetica")
      .fillColor(GRIS)
      .text(
        `${rotulo} · Página ${i - start + 1} de ${count}`,
        izquierda,
        doc.page.height - margenInferior + 12,
        { width: ancho, align: "right", lineBreak: false },
      );
    doc.page.margins.bottom = margenInferior;
  }
}

const RELLENO_X = 4;
const RELLENO_Y = 4;
const TAMANO_TEXTO = 7.5;

/** Cifras a la derecha, para que las unidades queden alineadas */
function esColumnaNumerica(campo: string, filas: Fila[]): boolean {
  let alguna = false;
  for (const fila of filas) {
    const v = fila[campo];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "number" || (typeof v === "string" && !Number.isNaN(Number(v)))) {
      alguna = true;
      continue;
    }
    return false;
  }
  return alguna;
}

/**
 * Anchos de columna. Se parte del peso relativo de cada columna, pero ninguna
 * baja de lo que necesita su palabra más larga ni sus valores cortos (fechas,
 * cifras): partidos a la mitad, «01/10/2026» o «Cantidad» se volvían ilegibles.
 */
function calcularAnchos(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaReporte[],
  textos: string[][],
  disponible: number,
): number[] {
  const minimos = columnas.map((c, i) => {
    doc.font("Helvetica-Bold").fontSize(TAMANO_TEXTO);
    let minimo = Math.max(
      ...c.titulo.split(/\s+/).map((palabra) => doc.widthOfString(palabra)),
    );
    doc.font("Helvetica").fontSize(TAMANO_TEXTO);
    for (const fila of textos) {
      const texto = fila[i];
      // Los valores cortos no se parten; los largos (nombres) sí pueden
      // ocupar varias líneas.
      const palabras = texto.length <= 12 ? [texto] : texto.split(/\s+/);
      for (const palabra of palabras) {
        minimo = Math.max(minimo, Math.min(doc.widthOfString(palabra), 90));
      }
    }
    return minimo + RELLENO_X * 2 + 1;
  });

  // Una columna sin ningún valor en este reporte (p. ej. Discapacidades cuando
  // nadie tiene) cede su espacio a las que sí traen texto
  const pesos = columnas.map((c, i) => {
    const peso = c.ancho ?? 18;
    return textos.every((fila) => fila[i] === "") ? peso * 0.35 : peso;
  });
  const pesoTotal = pesos.reduce((suma, p) => suma + p, 0);
  let anchos = pesos.map((peso, i) =>
    Math.max(minimos[i], (peso / pesoTotal) * disponible),
  );

  // Si los mínimos empujaron el total más allá de la página, se recorta de las
  // columnas que tienen holgura, en proporción a esa holgura.
  const exceso = anchos.reduce((a, b) => a + b, 0) - disponible;
  if (exceso > 0) {
    const holguras = anchos.map((a, i) => a - minimos[i]);
    const holguraTotal = holguras.reduce((a, b) => a + b, 0);
    anchos = anchos.map((a, i) =>
      holguraTotal > 0 ? a - (holguras[i] / holguraTotal) * exceso : a,
    );
  } else if (exceso < 0) {
    anchos = anchos.map((a) => a * (disponible / (disponible + exceso)));
  }
  return anchos;
}

/**
 * Tabla paginada. Cada fila mide lo que ocupa su celda más alta: un nombre de
 * programa largo baja a la línea siguiente dentro de su fila en lugar de pisar
 * la de abajo, que es lo que pasaba con un alto fijo.
 */
function escribirTablaPdf(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaReporte[],
  filas: Fila[],
): void {
  const izquierda = doc.page.margins.left;
  const disponible =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const limiteInferior = doc.page.height - doc.page.margins.bottom;

  const textos = filas.map((fila) =>
    columnas.map((c) => formatearValor(c.campo, fila[c.campo])),
  );
  const anchos = calcularAnchos(doc, columnas, textos, disponible);
  const alineacion = columnas.map((c) =>
    esColumnaNumerica(c.campo, filas) ? ("right" as const) : ("left" as const),
  );

  const altoDe = (celdas: string[], fuente: string): number => {
    doc.font(fuente).fontSize(TAMANO_TEXTO);
    return (
      Math.max(
        ...celdas.map((t, i) =>
          doc.heightOfString(t || " ", { width: anchos[i] - RELLENO_X * 2 }),
        ),
      ) +
      RELLENO_Y * 2
    );
  };

  const escribirCeldas = (
    celdas: string[],
    y: number,
    fuente: string,
  ): void => {
    doc.font(fuente).fontSize(TAMANO_TEXTO).fillColor(TINTA);
    let x = izquierda;
    celdas.forEach((texto, i) => {
      doc.text(texto, x + RELLENO_X, y + RELLENO_Y, {
        width: anchos[i] - RELLENO_X * 2,
        align: alineacion[i],
      });
      x += anchos[i];
    });
  };

  const titulos = columnas.map((c) => c.titulo);
  const altoEncabezado = altoDe(titulos, "Helvetica-Bold");

  const encabezado = (y: number): number => {
    doc.rect(izquierda, y, disponible, altoEncabezado).fillColor(FONDO_ENCABEZADO).fill();
    escribirCeldas(titulos, y, "Helvetica-Bold");
    doc
      .moveTo(izquierda, y + altoEncabezado)
      .lineTo(izquierda + disponible, y + altoEncabezado)
      .strokeColor(LINEA)
      .lineWidth(0.8)
      .stroke();
    return y + altoEncabezado;
  };

  let y = encabezado(doc.y);

  textos.forEach((celdas, indice) => {
    const alto = altoDe(celdas, "Helvetica");
    if (y + alto > limiteInferior) {
      doc.addPage();
      y = encabezado(doc.page.margins.top);
    }

    // Franja alterna para que la fila se siga con la vista en tablas anchas
    if (indice % 2 === 1) {
      doc.rect(izquierda, y, disponible, alto).fillColor(FRANJA).fill();
    }
    escribirCeldas(celdas, y, "Helvetica");
    doc
      .moveTo(izquierda, y + alto)
      .lineTo(izquierda + disponible, y + alto)
      .strokeColor(LINEA)
      .lineWidth(0.3)
      .stroke();
    y += alto;
  });

  doc.x = izquierda;
  doc.y = y + 6;
}
