import { Router } from "express";
import {
  loginController,
  logoutController,
  meController,
} from "./auth.controller.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { permitirSinRol } from "../../middlewares/role.middleware.js";
import { limiteLogin } from "../../middlewares/rate-limit.middleware.js";

const router = Router();

// El limite va antes del controller: frena la fuerza bruta contra bcrypt sin
// llegar a calcular el hash
router.post(
  "/login",
  limiteLogin,
  permitirSinRol("Público por definición: aquí todavía no hay usuario ni rol."),
  loginController,
);
router.post(
  "/logout",
  requireAuth,
  permitirSinRol("Cerrar la propia sesión no depende del rol."),
  logoutController,
);
router.get(
  "/me",
  requireAuth,
  permitirSinRol(
    "Devuelve la identidad del propio solicitante; el frontend la necesita para recuperar la sesión al recargar, porque la cookie es HttpOnly.",
  ),
  meController,
);

export default router;
