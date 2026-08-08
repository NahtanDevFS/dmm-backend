import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import routes from "./routes/routes.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { limiteGeneral } from "./middlewares/rate-limit.middleware.js";

const app = express();

/**
 * `trust proxy` en 1: en el VPS la aplicación queda detrás de un proxy inverso
 * (nginx), y sin esto `req.ip` sería siempre la IP del proxy — con lo que el
 * límite de peticiones por IP se aplicaría a todo el tráfico junto. Se confía en
 * un solo salto, no en toda la cadena de X-Forwarded-For, que un cliente puede
 * falsificar.
 */
app.set("trust proxy", 1);

app.use(
  helmet({
    /**
     * Los archivos subidos (documentos de identificación, evidencias de entrega)
     * se sirven desde este mismo backend y el frontend los muestra desde otro
     * origen. La política por defecto de helmet es `same-origin`, que haría que
     * el navegador bloqueara esas imágenes.
     */
    crossOriginResourcePolicy: { policy: "cross-origin" },
    /**
     * Esta API no devuelve HTML, así que la CSP no protege nada aquí y solo
     * estorbaría si algún día se sirve documentación. Se deja desactivada de
     * forma explícita para que la decisión quede visible y no parezca un olvido.
     */
    contentSecurityPolicy: false,
  }),
);

const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(cookieParser());
// Límite de tamaño explícito: por defecto express.json admite 100 kb, pero
// dejarlo escrito evita que un cambio de versión lo mueva sin que nadie lo note.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", limiteGeneral);
app.use("/api", routes);

app.use(errorHandler);

export default app;
