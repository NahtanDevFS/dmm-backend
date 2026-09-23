import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Error inesperado en el pool de pg:", err);
});

// El listener de arriba solo cubre las conexiones ociosas. Si una se cae
// mientras está prestada (un reinicio de PostgreSQL a mitad de una
// transacción), pg emite "error" en el propio cliente y, sin nadie que lo
// escuche, Node termina el proceso. La consulta en curso ya falla por su
// lado; esto solo evita que se caiga el servidor completo.
pool.on("connect", (client) => {
  client.on("error", (err) => {
    console.error("Se perdió una conexión con la base de datos:", err);
  });
});
