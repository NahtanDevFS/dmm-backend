import type { Response } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

/**
 * Exportación de reportes a Excel y PDF (RF-REP-05). Resuelve la decisión
 * pendiente #2 del documento maestro.
 *
 * Elección: **exceljs** para Excel y **pdfkit** para PDF. Se descartó
 * puppeteer/headless Chrome pese a que permitiría maquetar con HTML: arrastra
 * un navegador completo (~300 MB) y necesita librerías del sistema, lo cual es
 * desproporcionado para un VPS modesto y para reportes que son tablas. pdfkit
 * genera el PDF en proceso, sin binarios externos, a cambio de maquetar la
 * tabla a mano — que es lo que hace `escribirTablaPdf`.
 */

export type FormatoReporte = "json" | "xlsx" | "pdf";

export interface ColumnaReporte {
  /** Clave en las filas devueltas por la consulta. */
  campo: string;
  /** Encabezado legible para el usuario. */
  titulo: string;
  /** Ancho relativo; se usa tanto en Excel como en el PDF. */
  ancho?: number;
}

type Fila = Record<string, unknown>;

function formatearValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return String(valor);
}

function nombreArchivo(titulo: string, extension: string): string {
  const base = titulo
    .toLowerCase()
    // NFD separa la letra de su acento y el filtro siguiente descarta el acento,
    // así "población" queda "poblacion" y no "poblaci-n".
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

  // El nombre de una hoja de Excel no admite : \ / ? * [ ] y va hasta 31 chars.
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
        columnas.map((c) => [c.campo, normalizarParaExcel(fila[c.campo])]),
      ),
    );
  }

  hoja.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columnas.length },
  };

  // Los DATE de Postgres llegan como Date de JS y Excel los mostraría con hora y
  // zona horaria. Se detecta la columna por su primer valor y se le fija formato
  // de fecha, para que la Directora vea "2026-08-08" y no un timestamp.
  columnas.forEach((c, indice) => {
    const primerValor = filas.find((f) => f[c.campo] != null)?.[c.campo];
    if (primerValor instanceof Date) {
      hoja.getColumn(indice + 1).numFmt = "yyyy-mm-dd";
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

/**
 * Los NUMERIC de Postgres llegan como string para no perder precisión. En Excel
 * conviene que sean números para poder sumarlos, así que se reconvierten cuando
 * la cadena es numérica.
 */
function normalizarParaExcel(valor: unknown): unknown {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string" && valor !== "" && !Number.isNaN(Number(valor))) {
    return Number(valor);
  }
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return valor;
}

export function responderPdf(
  res: Response,
  titulo: string,
  columnas: ColumnaReporte[],
  filas: Fila[],
  subtitulo?: string,
): void {
  // landscape: los reportes son anchos y en vertical no caben las columnas.
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${nombreArchivo(titulo, "pdf")}"`,
  );
  doc.pipe(res);

  doc.fontSize(15).font("Helvetica-Bold").text("Dirección Municipal de la Mujer");
  doc.fontSize(11).font("Helvetica").text("Usumatlán, Zacapa");
  doc.moveDown(0.6);
  doc.fontSize(13).font("Helvetica-Bold").text(titulo);
  if (subtitulo) {
    doc.fontSize(9).font("Helvetica").fillColor("#444").text(subtitulo);
    doc.fillColor("#000");
  }
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#666")
    .text(
      `Generado el ${new Date().toLocaleString("es-GT")} · ${filas.length} registro(s)`,
    );
  doc.fillColor("#000");
  doc.moveDown(0.8);

  if (filas.length === 0) {
    doc
      .fontSize(10)
      .font("Helvetica-Oblique")
      .text("No hay datos para los filtros seleccionados.");
  } else {
    escribirTablaPdf(doc, columnas, filas);
  }

  doc.end();
}

/**
 * Tabla paginada. pdfkit no tiene tablas, así que se calculan los anchos
 * proporcionalmente al espacio disponible y se repite el encabezado en cada
 * página nueva.
 */
function escribirTablaPdf(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaReporte[],
  filas: Fila[],
): void {
  const izquierda = doc.page.margins.left;
  const disponible =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const limiteInferior = doc.page.height - doc.page.margins.bottom - 20;

  const pesoTotal = columnas.reduce((suma, c) => suma + (c.ancho ?? 18), 0);
  const anchos = columnas.map(
    (c) => ((c.ancho ?? 18) / pesoTotal) * disponible,
  );

  const alturaFila = 16;

  const encabezado = (y: number): number => {
    doc.fontSize(8).font("Helvetica-Bold");
    let x = izquierda;
    columnas.forEach((c, i) => {
      doc.text(c.titulo, x + 2, y + 4, {
        width: anchos[i] - 4,
        ellipsis: true,
      });
      x += anchos[i];
    });
    doc
      .moveTo(izquierda, y + alturaFila)
      .lineTo(izquierda + disponible, y + alturaFila)
      .strokeColor("#999")
      .lineWidth(0.7)
      .stroke();
    return y + alturaFila + 2;
  };

  let y = encabezado(doc.y);

  doc.fontSize(7.5).font("Helvetica");
  filas.forEach((fila, indice) => {
    if (y + alturaFila > limiteInferior) {
      doc.addPage();
      y = encabezado(doc.page.margins.top);
      doc.fontSize(7.5).font("Helvetica");
    }

    // Franja alterna para que la fila se siga con la vista en tablas anchas.
    if (indice % 2 === 1) {
      doc
        .rect(izquierda, y, disponible, alturaFila)
        .fillColor("#f2f2f2")
        .fill()
        .fillColor("#000");
    }

    let x = izquierda;
    columnas.forEach((c, i) => {
      doc.text(formatearValor(fila[c.campo]), x + 2, y + 4, {
        width: anchos[i] - 4,
        ellipsis: true,
        lineBreak: false,
      });
      x += anchos[i];
    });
    y += alturaFila;
  });
}
