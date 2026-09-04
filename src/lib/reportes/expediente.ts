import type { Response } from "express";
import PDFDocument from "pdfkit";
import type {
  CabeceraExpediente,
  LineaExpediente,
  FormularioExpediente,
  DocumentoExpediente,
  EntregaExpediente,
} from "../../modules/solicitudes/expediente.repository.js";

/**
 * Expediente de una solicitud, en un solo PDF.
 *
 * Es un documento interno: no imita las hojas de Orden de Malta, porque el
 * papel firmado ya se escanea y se adjunta. Este sirve para revisar y
 * archivar lo que el sistema tiene registrado, así que prioriza el orden y la
 * legibilidad sobre el parecido con el formulario impreso.
 *
 * Vertical y no apaisado como los reportes: esto son fichas y párrafos, no
 * tablas anchas.
 *
 * Los campos sin responder se imprimen con un guion en vez de omitirse. Un
 * expediente que oculta sus huecos disimula lo que falta, y ver los huecos es
 * justamente para lo que alguien lo revisa.
 */

const MARGEN = 45;
const GRIS = "#555";
const TINTA = "#241C20";

type Doc = PDFKit.PDFDocument;

function nombreArchivo(id: number): string {
  const fecha = new Date().toISOString().slice(0, 10);
  return `expediente-solicitud-${id}-${fecha}.pdf`;
}

function fecha(valor: Date | string | null): string {
  if (!valor) return "—";
  const d = valor instanceof Date ? valor : new Date(valor);
  return d.toISOString().slice(0, 10);
}

function texto(valor: string | null | undefined): string {
  const limpio = (valor ?? "").trim();
  return limpio === "" ? "—" : limpio;
}

/** Salta de página si lo que viene no entra en lo que queda. */
function asegurarEspacio(doc: Doc, alto: number): void {
  if (doc.y + alto > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function titulo(doc: Doc, texto: string): void {
  // Un título solo al pie de página deja huérfano lo que anuncia, así que se
  // exige espacio para él y para algo de contenido debajo.
  asegurarEspacio(doc, 60);
  doc.moveDown(0.8);
  doc.x = MARGEN;
  doc
    .fillColor(TINTA)
    .fontSize(12)
    .font("Helvetica-Bold")
    .text(texto, MARGEN, doc.y, { width: doc.page.width - MARGEN * 2 });
  const y = doc.y + 2;
  doc
    .moveTo(MARGEN, y)
    .lineTo(doc.page.width - MARGEN, y)
    .strokeColor("#E4DCE0")
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.5);
}

function subtitulo(doc: Doc, valor: string): void {
  const ancho = doc.page.width - MARGEN * 2;
  const alto = doc
    .fontSize(10)
    .font("Helvetica-Bold")
    .heightOfString(valor, { width: ancho });

  asegurarEspacio(doc, alto + 14);

  doc.moveDown(0.4);
  const y = doc.y;
  doc
    .fillColor(TINTA)
    .fontSize(10)
    .font("Helvetica-Bold")
    .text(valor, MARGEN, y, {
      width: ancho,
    });
  doc.y = y + alto + 4;
  doc.x = MARGEN;
}

/**
 * Un dato con su etiqueta, en dos columnas. Es la unidad de la que se
 * componen casi todas las secciones.
 *
 * Las dos columnas se dibujan en la MISMA `y`, así que el avance vertical lo
 * marca la más alta de las dos. Medir solo el valor hacía que una etiqueta de
 * dos líneas quedara pisada por el dato siguiente.
 *
 * Y la altura se mide ANTES de reservar espacio, no después: si se reserva de
 * menos, pdfkit salta de página por su cuenta al escribir y el `doc.y` que se
 * fija a continuación apunta a una posición de la página anterior, con lo que
 * todo lo que sigue se dibuja encima de lo ya escrito.
 */
function dato(doc: Doc, etiqueta: string, valor: string): void {
  const anchoEtiqueta = 150;
  const anchoValor = doc.page.width - MARGEN * 2 - anchoEtiqueta - 10;

  const alturaEtiqueta = doc
    .fontSize(9)
    .font("Helvetica")
    .heightOfString(etiqueta, { width: anchoEtiqueta });

  const alturaValor = doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .heightOfString(valor, { width: anchoValor });

  const alto = Math.max(alturaEtiqueta, alturaValor, 12);
  asegurarEspacio(doc, alto + 3);

  const y = doc.y;

  doc
    .fillColor(GRIS)
    .fontSize(9)
    .font("Helvetica")
    .text(etiqueta, MARGEN, y, { width: anchoEtiqueta });

  doc
    .fillColor(TINTA)
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(valor, MARGEN + anchoEtiqueta + 10, y, { width: anchoValor });

  doc.y = y + alto + 3;
  doc.x = MARGEN;
}

function parrafo(doc: Doc, valor: string): void {
  const ancho = doc.page.width - MARGEN * 2;

  // Mismo motivo que en `dato`: se mide primero para reservar lo que de
  // verdad ocupa, en vez de un alto fijo que se queda corto con dos líneas.
  const alto = doc
    .fontSize(9)
    .font("Helvetica")
    .heightOfString(valor, { width: ancho });

  asegurarEspacio(doc, alto + 4);

  const y = doc.y;
  doc.fillColor(GRIS).fontSize(9).font("Helvetica").text(valor, MARGEN, y, {
    width: ancho,
  });
  doc.y = y + alto + 4;
  doc.x = MARGEN;
}

/**
 * Un grupo repetible como tabla: una fila por integrante, una columna por
 * campo. Reproducirlo como pares etiqueta-valor lo volvería ilegible con seis
 * personas en el hogar.
 */
function tablaGrupo(doc: Doc, encabezados: string[], filas: string[][]): void {
  const disponible = doc.page.width - MARGEN * 2;
  const ancho = disponible / encabezados.length;
  const alturaFila = 16;

  // El encabezado sí puede ocupar dos líneas: las etiquetas de los campos son
  // frases, no palabras. Se mide la más alta y todas arrancan de la misma y.
  doc.fontSize(8).font("Helvetica-Bold");
  const alturaEncabezado = Math.max(
    ...encabezados.map((h) => doc.heightOfString(h, { width: ancho - 4 })),
    alturaFila,
  );

  asegurarEspacio(doc, alturaEncabezado + alturaFila);

  let y = doc.y;
  doc.fillColor(GRIS);
  encabezados.forEach((h, i) => {
    doc.text(h, MARGEN + i * ancho, y, { width: ancho - 4 });
  });
  y += alturaEncabezado + 4;
  doc
    .moveTo(MARGEN, y - 3)
    .lineTo(doc.page.width - MARGEN, y - 3)
    .strokeColor("#E4DCE0")
    .stroke();

  doc.fillColor(TINTA).font("Helvetica");
  for (const fila of filas) {
    if (y + alturaFila > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.y;
      // Se repite el encabezado: una tabla que sigue en la página siguiente
      // sin encabezado obliga a volver atrás para saber qué es cada columna.
      doc.fillColor(GRIS).fontSize(8).font("Helvetica-Bold");
      encabezados.forEach((h, i) => {
        doc.text(h, MARGEN + i * ancho, y, { width: ancho - 4 });
      });
      y += alturaEncabezado + 4;
      doc.fillColor(TINTA).font("Helvetica");
    }
    fila.forEach((celda, i) => {
      doc.text(celda, MARGEN + i * ancho, y, {
        width: ancho - 4,
        ellipsis: true,
      });
    });
    y += alturaFila;
  }

  doc.y = y + 4;
  doc.x = MARGEN;
}

/** Reparte las respuestas de un formulario entre campos sueltos y grupos. */
function escribirFormulario(doc: Doc, formulario: FormularioExpediente): void {
  subtitulo(
    doc,
    formulario.nombre + (formulario.completado ? "" : "  (incompleto)"),
  );

  const sueltos = formulario.respuestas.filter((r) => !r.grupo_repetible);
  const conGrupo = formulario.respuestas.filter((r) => r.grupo_repetible);

  for (const respuesta of sueltos) {
    dato(doc, respuesta.etiqueta, texto(respuesta.valor));
  }

  // Cada grupo repetible se arma como tabla: campos en columnas, filas en
  // filas. Las respuestas vienen planas, con numero_fila diciendo a qué fila
  // pertenece cada una.
  const grupos = new Map<string, RespuestasDelGrupo>();
  for (const respuesta of conGrupo) {
    const nombre = respuesta.grupo_repetible!;
    let grupo = grupos.get(nombre);
    if (!grupo) {
      grupo = { campos: new Map(), filas: new Map() };
      grupos.set(nombre, grupo);
    }
    grupo.campos.set(respuesta.campo_id, respuesta.etiqueta);

    if (respuesta.numero_fila === null) continue;
    const fila = grupo.filas.get(respuesta.numero_fila) ?? new Map();
    fila.set(respuesta.campo_id, respuesta.valor);
    grupo.filas.set(respuesta.numero_fila, fila);
  }

  for (const [nombre, grupo] of grupos) {
    doc.moveDown(0.3);
    doc.fillColor(GRIS).fontSize(9).font("Helvetica-Oblique").text(nombre);
    doc.moveDown(0.2);
    doc.x = MARGEN;

    const idsCampo = [...grupo.campos.keys()];
    const encabezados = idsCampo.map((id) => grupo.campos.get(id)!);

    if (grupo.filas.size === 0) {
      parrafo(doc, "Sin filas registradas.");
      continue;
    }

    const filas = [...grupo.filas.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, valores]) =>
        idsCampo.map((id) => texto(valores.get(id) ?? null)),
      );

    tablaGrupo(doc, encabezados, filas);
  }
}

interface RespuestasDelGrupo {
  campos: Map<number, string>;
  filas: Map<number, Map<number, string | null>>;
}

export function responderExpedientePdf(
  res: Response,
  datos: {
    cabecera: CabeceraExpediente;
    lineas: LineaExpediente[];
    formulariosPorLinea: Map<number, FormularioExpediente[]>;
    documentos: DocumentoExpediente[];
    entregas: EntregaExpediente[];
  },
): void {
  const { cabecera, lineas, formulariosPorLinea, documentos, entregas } = datos;

  const doc = new PDFDocument({ size: "LETTER", margin: MARGEN });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${nombreArchivo(cabecera.solicitud_id)}"`,
  );
  doc.pipe(res);

  // ── Encabezado ──────────────────────────────────────────────────────────
  doc
    .fillColor(TINTA)
    .fontSize(15)
    .font("Helvetica-Bold")
    .text("Dirección Municipal de la Mujer");
  doc.fontSize(10).font("Helvetica").fillColor(GRIS).text("Usumatlán, Zacapa");
  doc.moveDown(0.5);
  doc
    .fillColor(TINTA)
    .fontSize(13)
    .font("Helvetica-Bold")
    .text("Expediente de solicitud n.º " + cabecera.solicitud_id);
  doc
    .fillColor(GRIS)
    .fontSize(8)
    .font("Helvetica")
    .text("Generado el " + new Date().toLocaleString("es-GT"));

  // ── La persona ──────────────────────────────────────────────────────────
  titulo(doc, "Datos del beneficiario");
  dato(doc, "Nombre completo", cabecera.nombres + " " + cabecera.apellidos);
  dato(doc, "CUI / DPI", texto(cabecera.cui_dpi));
  dato(doc, "Fecha de nacimiento", fecha(cabecera.fecha_nacimiento));
  dato(
    doc,
    "Lugar de nacimiento",
    cabecera.municipio_nacimiento
      ? cabecera.municipio_nacimiento +
          ", " +
          texto(cabecera.departamento_nacimiento)
      : "—",
  );
  dato(doc, "Género", texto(cabecera.genero));
  dato(doc, "Estado civil", texto(cabecera.estado_civil));
  dato(doc, "Grado académico", texto(cabecera.grado_academico));
  dato(doc, "Ocupación", texto(cabecera.ocupacion));
  dato(doc, "Teléfono", texto(cabecera.telefono));
  dato(doc, "Dirección", texto(cabecera.direccion));
  dato(
    doc,
    "Comunidad",
    cabecera.comunidad
      ? cabecera.comunidad +
          ", " +
          texto(cabecera.municipio) +
          ", " +
          texto(cabecera.departamento)
      : "—",
  );

  // ── La solicitud ────────────────────────────────────────────────────────
  titulo(doc, "Datos de la solicitud");
  dato(doc, "Fecha de solicitud", fecha(cabecera.fecha_solicitud));
  dato(doc, "Programa", cabecera.programa);
  dato(doc, "Estado", cabecera.estado);
  dato(
    doc,
    "Aprobación",
    cabecera.requiere_aprobacion
      ? cabecera.aprobada
        ? "Aprobada el " +
          fecha(cabecera.fecha_aprobacion) +
          " por " +
          texto(cabecera.aprobado_por)
        : "Requiere aprobación · pendiente"
      : "No requiere aprobación",
  );
  if (cabecera.observaciones_trabajo_social) {
    dato(
      doc,
      "Observaciones de trabajo social",
      cabecera.observaciones_trabajo_social,
    );
  }

  // ── Insumos y sus formularios ───────────────────────────────────────────
  titulo(doc, "Insumos solicitados");

  if (lineas.length === 0) {
    parrafo(doc, "La solicitud no tiene insumos registrados.");
  }

  for (const linea of lineas) {
    subtitulo(doc, linea.insumo + " · " + linea.modalidad);
    dato(
      doc,
      "Cantidad",
      linea.cantidad_entregada +
        " de " +
        linea.cantidad_requerida +
        " " +
        linea.unidad +
        (linea.presentacion && linea.cantidad_presentacion
          ? " (pedido: " +
            Number(linea.cantidad_presentacion) +
            " " +
            linea.presentacion +
            ")"
          : ""),
    );
    dato(doc, "Estado", linea.estado);

    const formularios =
      formulariosPorLinea.get(linea.detalle_solicitud_id) ?? [];
    if (formularios.length === 0) {
      parrafo(doc, "Este insumo no exige formularios.");
    }
    for (const formulario of formularios) {
      escribirFormulario(doc, formulario);
    }
  }

  // ── Entregas ────────────────────────────────────────────────────────────
  titulo(doc, "Entregas registradas");
  if (entregas.length === 0) {
    parrafo(doc, "Todavía no se ha despachado nada de esta solicitud.");
  } else {
    tablaGrupo(
      doc,
      ["Fecha", "Insumo", "Cantidad", "Entregó", "Recibió", "Estado"],
      entregas.map((e) => [
        fecha(e.fecha_entrega),
        e.insumo,
        String(e.cantidad_entregada),
        e.entregado_por,
        texto(e.receptor),
        e.activo ? "Vigente" : "Anulada",
      ]),
    );
  }

  // ── Documentos ──────────────────────────────────────────────────────────
  titulo(doc, "Documentos adjuntos");
  if (documentos.length === 0) {
    parrafo(doc, "No hay documentos adjuntos a esta solicitud.");
  } else {
    // Se listan, no se incrustan: los archivos viven detrás de la sesión y
    // meterlos dentro convertiría el expediente en algo de varios megas.
    parrafo(
      doc,
      "Los archivos se consultan desde el sistema; aquí solo se deja constancia de cuáles existen.",
    );
    for (const documento of documentos) {
      dato(
        doc,
        texto(documento.descripcion ?? documento.formulario),
        documento.ruta_archivo.split("/").pop() ?? documento.ruta_archivo,
      );
    }
  }

  doc.end();
}
