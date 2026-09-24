import type { PoolClient } from "pg";
import { pool } from "./pool.js";

export async function withUserTransaction<T>(
  userId: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  // Si el ROLLBACK falla, la conexión quedó en un estado desconocido (caída, o
  // con la transacción abierta): se destruye en vez de devolverla al pool
  let conexionInservible: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.usuario_id', $1, true)", [
      String(userId),
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (errorRollback) {
      console.error(
        "[withUserTransaction] Falló el ROLLBACK; se descarta la conexión:",
        errorRollback,
      );
      conexionInservible =
        errorRollback instanceof Error
          ? errorRollback
          : new Error(String(errorRollback));
    }
    // Siempre el error original: es el que explica qué salió mal, el del
    // ROLLBACK solo es una consecuencia y queda en el log
    throw error;
  } finally {
    client.release(conexionInservible);
  }
}
