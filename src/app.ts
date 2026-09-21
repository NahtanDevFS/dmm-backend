import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import routes from "./routes/routes.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { limiteGeneral } from "./middlewares/rate-limit.middleware.js";
import { verificarRutasProtegidas } from "./lib/rutas-protegidas.js";

const app = express();

// Confía en el proxy inverso para obtener la IP real del cliente
app.set("trust proxy", 1);

app.use(
  helmet({
    // Permite servir archivos al frontend en distinto origen
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Desactiva CSP porque la API no devuelve HTML
    contentSecurityPolicy: false,
  }),
);

const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
    // Expone headers de rate limit para que el frontend muestre intentos restantes
    exposedHeaders: ["RateLimit", "RateLimit-Policy"],
  }),
);
app.use(cookieParser());
// Límite explícito de tamaño para evitar cambios por defecto
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", limiteGeneral);
app.use("/api", routes);

app.use(errorHandler);

// Valida que todas las rutas tengan requireRole antes de arrancar
verificarRutasProtegidas(routes);

export default app;
