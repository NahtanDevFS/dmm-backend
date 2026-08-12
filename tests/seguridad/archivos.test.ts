import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

/**
 * Validacion de archivos subidos.
 *
 * La regla que se protege: el tipo se decide por la FIRMA BINARIA del
 * contenido, no por la extension ni por el Content-Type que manda el cliente.
 * Ambos los controla quien sube el archivo, asi que confiar en ellos permitiria
 * guardar cualquier cosa con solo renombrarla a .jpg.
 *
 * UPLOADS_DIR se apunta a un directorio temporal ANTES de importar el modulo,
 * porque storage.service lo lee al cargarse. Por eso el import es dinamico.
 */

let carpetaTemporal: string;
let storage: typeof import("../../src/lib/storage/storage.service.js");
/**
 * El limite vive en file-validation, no en storage.service: se importa de su
 * modulo real para que la prueba use el mismo valor que el codigo y no una
 * copia que pueda quedar desfasada.
 */
let TAMANO_MAXIMO_BYTES: number;

beforeAll(async () => {
  carpetaTemporal = await mkdtemp(path.join(tmpdir(), "dmm-archivos-"));
  process.env.UPLOADS_DIR = carpetaTemporal;
  storage = await import("../../src/lib/storage/storage.service.js");
  ({ TAMANO_MAXIMO_BYTES } =
    await import("../../src/lib/storage/file-validation.js"));
}, 30_000);

afterAll(async () => {
  await rm(carpetaTemporal, { recursive: true, force: true });
});

/** Imagen JPEG real, generada en memoria. */
async function jpegValido(ancho = 40, alto = 40): Promise<Buffer> {
  return sharp({
    create: {
      width: ancho,
      height: alto,
      channels: 3,
      background: { r: 120, g: 140, b: 160 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe("validacion por firma binaria", () => {
  it("acepta una imagen JPEG real", async () => {
    const guardado = await storage.guardarArchivo(
      await jpegValido(),
      "documentos-persona",
    );

    expect(guardado.rutaRelativa).toMatch(/^documentos-persona\//);
    expect(guardado.mimeType).toBe("image/jpeg");
  });

  it("acepta un PDF real y conserva su extension", async () => {
    // %PDF- es la firma; el resto es relleno minimo.
    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n",
      "latin1",
    );

    const guardado = await storage.guardarArchivo(pdf, "recetas-medicas");

    expect(guardado.rutaRelativa).toMatch(/\.pdf$/);
    expect(guardado.mimeType).toBe("application/pdf");
  });

  it("rechaza un texto plano aunque se llame .jpg", async () => {
    // El caso central: la extension no interviene en la decision.
    const texto = Buffer.from("Esto no es una imagen, es texto plano.", "utf8");

    await expect(
      storage.guardarArchivo(texto, "documentos-persona"),
    ).rejects.toThrow(/no es una imagen .* ni un PDF/i);
  });

  it("rechaza un ejecutable disfrazado", async () => {
    // 'MZ' es la firma de un .exe de Windows.
    const ejecutable = Buffer.concat([
      Buffer.from("MZ"),
      Buffer.alloc(1024, 0x90),
    ]);

    await expect(
      storage.guardarArchivo(ejecutable, "evidencia-entrega"),
    ).rejects.toThrow(/no es una imagen .* ni un PDF/i);
  });

  it("rechaza un tipo no permitido aunque sea un archivo valido", async () => {
    // GIF es una imagen legitima, pero no esta en la lista blanca.
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );

    await expect(
      storage.guardarArchivo(gif, "documentos-persona"),
    ).rejects.toThrow(/no es una imagen .* ni un PDF/i);
  });

  it("rechaza un archivo vacio", async () => {
    await expect(
      storage.guardarArchivo(Buffer.alloc(0), "documentos-persona"),
    ).rejects.toThrow();
  });

  it("rechaza un archivo que excede el tamaño maximo", async () => {
    const enorme = Buffer.alloc(TAMANO_MAXIMO_BYTES + 1, 0x41);

    await expect(
      storage.guardarArchivo(enorme, "documentos-persona"),
    ).rejects.toThrow(/tamaño máximo/i);
  });
});

describe("normalizacion de imagenes", () => {
  it("reduce una imagen grande y la reescribe como JPEG", async () => {
    // Recomprimir siempre descarta cualquier payload incrustado en los
    // metadatos, ademas de ahorrar disco.
    const grande = await jpegValido(3000, 2000);
    const guardado = await storage.guardarArchivo(grande, "evidencia-entrega");

    const metadatos = await sharp(
      path.join(carpetaTemporal, guardado.rutaRelativa),
    ).metadata();

    expect(metadatos.width).toBeLessThanOrEqual(1600);
    expect(metadatos.height).toBeLessThanOrEqual(1600);
    expect(metadatos.format).toBe("jpeg");
  });

  it("convierte un PNG a JPEG", async () => {
    const png = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 3,
        background: { r: 200, g: 30, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const guardado = await storage.guardarArchivo(png, "documentos-persona");

    expect(guardado.rutaRelativa).toMatch(/\.jpg$/);
    expect(guardado.mimeType).toBe("image/jpeg");
  });

  it("no recomprime los PDF", async () => {
    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n",
      "latin1",
    );

    const guardado = await storage.guardarArchivo(pdf, "recetas-medicas");

    expect(guardado.tamanoBytes).toBe(pdf.byteLength);
  });
});

describe("nombres de archivo en disco", () => {
  it("genera siempre un nombre propio, nunca el del cliente", async () => {
    // Si se respetara el nombre original, un archivo llamado
    // "../../.env" escribiria fuera de la carpeta de subidas.
    const a = await storage.guardarArchivo(
      await jpegValido(),
      "documentos-persona",
    );
    const b = await storage.guardarArchivo(
      await jpegValido(),
      "documentos-persona",
    );

    expect(a.rutaRelativa).not.toBe(b.rutaRelativa);
    // UUID v4 + extension, sin rastro de nada que venga de fuera.
    expect(path.basename(a.rutaRelativa)).toMatch(
      /^[0-9a-f-]{36}\.(jpg|pdf)$/i,
    );
  });

  it("usa separadores POSIX en la ruta persistida", async () => {
    // La ruta se guarda en la base y se sirve por HTTP: una barra invertida
    // de Windows la romperia al reconstruir la URL.
    const guardado = await storage.guardarArchivo(
      await jpegValido(),
      "evidencia-entrega",
    );

    expect(guardado.rutaRelativa).not.toContain("\\");
    expect(guardado.rutaRelativa.split("/")).toHaveLength(2);
  });
});

describe("proteccion contra path traversal al servir", () => {
  /**
   * Reproduce la comprobacion de archivos.routes.ts: resolver ambos lados a
   * ruta absoluta y comparar el prefijo.
   *
   * El bug real que documenta: comparar sin `path.resolve` en el lado de
   * UPLOADS_DIR hacia fallar TODAS las descargas cuando la variable venia como
   * "./uploads", porque path.join elimina el "./" y el startsWith daba false.
   */
  function rutaPermitida(base: string, solicitada: string): boolean {
    const raiz = path.resolve(base);
    const destino = path.resolve(raiz, solicitada);
    return destino === raiz || destino.startsWith(raiz + path.sep);
  }

  it("permite una ruta legitima dentro de la carpeta", () => {
    expect(rutaPermitida("./uploads", "documentos-persona/abc-123.jpg")).toBe(
      true,
    );
  });

  it("bloquea el ascenso con ..", () => {
    expect(rutaPermitida("./uploads", "../.env")).toBe(false);
    expect(rutaPermitida("./uploads", "documentos-persona/../../.env")).toBe(
      false,
    );
    expect(rutaPermitida("./uploads", "../../etc/passwd")).toBe(false);
  });

  it("bloquea una ruta absoluta", () => {
    const absoluta =
      process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    expect(rutaPermitida("./uploads", absoluta)).toBe(false);
  });

  it("no confunde una carpeta hermana con prefijo comun", () => {
    // "uploads-privado" empieza por "uploads": comparar sin el separador
    // final la dejaria pasar.
    expect(rutaPermitida("./uploads", "../uploads-privado/secreto.pdf")).toBe(
      false,
    );
  });
});
