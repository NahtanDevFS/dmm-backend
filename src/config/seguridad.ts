/** Coste de bcrypt para todos los hashes de contraseña. El login lo usa también para su hash ficticio: si difiere del de los hashes reales, el tiempo de respuesta vuelve a delatar qué usuarios existen */
export const BCRYPT_ROUNDS = 12;
