export {};

declare global {
  namespace Express {
    interface Request {
      usuario?: {
        id: number;
        username: string;
        rol: string;
      };
      sesion?: {
        id: string;
      };
      /** Lo agrega express-rate-limit en las rutas con límite: intentos usados y restantes */
      rateLimit?: import("express-rate-limit").RateLimitInfo;
    }
  }
}
