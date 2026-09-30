/**
 * Una regla de negocio que la aplicación comprueba en TypeScript y rechaza.
 *
 * El middleware de errores responde con `status` y `message` a todo error que
 * traiga un status numérico. Un `new Error(...)` suelto no lo trae, así que
 * terminaba en un 500 "Error interno del servidor" y el usuario nunca veía
 * la explicación ("Este préstamo ya tiene una devolución registrada…").
 *
 * 400: el dato enviado no sirve. 404: lo referido no existe.
 * 409: choca con el estado actual del registro.
 */
export class ErrorDeNegocio extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409 = 409) {
    super(message);
    this.name = "ErrorDeNegocio";
    this.status = status;
  }
}
