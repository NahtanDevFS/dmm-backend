import { describe, it, expect } from "vitest";
import { esFechaCalendario, rangoValido } from "../src/lib/fechas.js";

/** QA-11: Date.parse aceptaba días inexistentes y formatos no canónicos, que luego PostgreSQL rechazaba con un 500 */
describe("esFechaCalendario", () => {
  it("acepta fechas reales en YYYY-MM-DD, incluido el 29 de febrero bisiesto", () => {
    for (const v of ["2024-02-29", "2025-01-01", "2025-12-31"]) {
      expect(esFechaCalendario(v)).toBe(true);
    }
  });

  it("rechaza días que no existen", () => {
    for (const v of ["2025-02-29", "2025-02-31", "2025-04-31", "2025-13-01", "2025-00-10"]) {
      expect(esFechaCalendario(v)).toBe(false);
    }
  });

  it("rechaza formatos no canónicos que Date.parse sí aceptaba", () => {
    for (const v of ["2024-9-01", "hola 1", "01/02/2025", "2025-01-01T00:00:00Z", ""]) {
      expect(esFechaCalendario(v)).toBe(false);
    }
  });
});

describe("rangoValido", () => {
  it("admite límites iguales y rangos abiertos", () => {
    expect(rangoValido({ desde: "2025-01-01", hasta: "2025-01-01" })).toBe(true);
    expect(rangoValido({ desde: "2025-01-01" })).toBe(true);
    expect(rangoValido({})).toBe(true);
  });

  it("rechaza el rango invertido", () => {
    expect(rangoValido({ desde: "2025-06-01", hasta: "2025-01-01" })).toBe(false);
  });

  it("no compara si alguna fecha es inválida: ese error ya lo reporta su campo", () => {
    expect(rangoValido({ desde: "2024-9-01", hasta: "2024-12-01" })).toBe(true);
  });
});
