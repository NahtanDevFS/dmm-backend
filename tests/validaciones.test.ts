import { describe, it, expect } from "vitest";
import { crearPersonaSchema } from "../src/modules/personas/persona.schema.js";
import { resetearPasswordSchema } from "../src/modules/usuarios/usuario.schema.js";

/** QA-12: el backend solo recortaba y limitaba a 13 caracteres; la API aceptaba "abc" o "" que la interfaz rechaza */
describe("CUI/DPI", () => {
  const base = {
    nombres: "Ana",
    apellidos: "Pérez",
    fecha_nacimiento: "1990-05-10",
  };
  const dpi = (cui_dpi: unknown) =>
    crearPersonaSchema.safeParse({ ...base, cui_dpi });

  it("acepta 13 dígitos, ausencia y null", () => {
    expect(dpi("1234567890101").success).toBe(true);
    expect(crearPersonaSchema.safeParse(base).success).toBe(true);
    expect(dpi(null).success).toBe(true);
  });

  it("guarda el vacío como null, no como cadena vacía", () => {
    for (const v of ["", "   "]) {
      const r = dpi(v);
      expect(r.success).toBe(true);
      expect(r.data?.cui_dpi).toBeNull();
    }
  });

  it("rechaza lo que no son exactamente 13 dígitos", () => {
    for (const v of ["abc", "1", "123456789010", "12345678901011", "1234 5678 90101"]) {
      expect(dpi(v).success).toBe(false);
    }
  });
});

/** QA-14: bcrypt solo usa los primeros 72 bytes; el límite se contaba en caracteres */
describe("contraseña y límite de bcrypt", () => {
  const valida = (password_nueva: string) =>
    resetearPasswordSchema.safeParse({ password_nueva }).success;

  it("acepta hasta 72 bytes ASCII", () => {
    expect(valida("a1" + "x".repeat(70))).toBe(true);
    expect(valida("a1" + "x".repeat(71))).toBe(false);
  });

  it("cuenta bytes, no caracteres: 40 eñes son 80 bytes", () => {
    const password = "a1" + "ñ".repeat(40); // 42 caracteres, 82 bytes
    expect(password.length).toBeLessThan(72);
    expect(valida(password)).toBe(false);
  });

  it("acepta tildes mientras no pase de 72 bytes", () => {
    expect(valida("Contraseña1 segura")).toBe(true);
  });
});
