import { Router } from "express";
import { loginController, logoutController } from "./auth.controller.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";

const router = Router();

router.post("/login", loginController);
router.post("/logout", requireAuth, logoutController);

export default router;
