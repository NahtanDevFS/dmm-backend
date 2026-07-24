import { randomBytes, createHash } from "node:crypto";

export const INACTIVIDAD_MAXIMA_MINUTOS = 30;

export const SESION_DURACION_MAXIMA_HORAS = 12;

export function generarTokenSesion(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function calcularExpiracionSesion(): Date {
  const expiraEn = new Date();
  expiraEn.setHours(expiraEn.getHours() + SESION_DURACION_MAXIMA_HORAS);
  return expiraEn;
}

export function sesionInactiva(ultimaActividad: Date): boolean {
  const limiteMs = INACTIVIDAD_MAXIMA_MINUTOS * 60 * 1000;
  return Date.now() - ultimaActividad.getTime() > limiteMs;
}
