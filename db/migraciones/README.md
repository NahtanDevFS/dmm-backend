# Migraciones SQL

Cambios de esquema y de configuración de la base de datos, en scripts numerados
y aplicados a mano. Continúa la numeración de los que el equipo ya tenía
(`06_sesiones.sql`, `07_genero_corto.sql` — obsoleta, `08_fix_fn_auditoria_clave_compuesta.sql`).

**Nunca `prisma migrate` ni `prisma db push` sobre esta base.** El flujo del
proyecto es al contrario: el cambio se escribe en SQL plano, se aplica, y después
se corre `pnpm prisma:pull && pnpm prisma:generate` para que Prisma se ponga al
día.

## Pendientes de aplicar

Los tres salieron de hallazgos durante el desarrollo y **todavía no se han
ejecutado en ninguna base**. Cada archivo explica el problema medido, la solución
y sus límites.

| Script | Qué corrige | Riesgo |
|---|---|---|
| `09_zona_horaria.sql` | La sesión de Postgres está en GMT: entre las 18:00 y medianoche local, todo `CURRENT_DATE` graba la fecha del día siguiente | Cambia cómo se calcula toda fecha nueva del sistema. No corrige los registros ya grabados |
| `10_auditoria_sesion_sin_latido.sql` | El 56% de `auditoria_log` es el refresco de `ultima_actividad` de cada petición | Reduce lo que se audita en `sesion`; ver el límite conocido dentro del archivo |
| `11_indices_auditoria.sql` | Faltan los índices por los que filtra `GET /api/auditoria` | Ninguno. Solo agrega índices |

## Cómo aplicarlos

```bash
corepack pnpm prisma db execute --file ./db/migraciones/11_indices_auditoria.sql
```

O pegando el contenido en pgAdmin.

Después de `09_zona_horaria.sql` hay que **reconectar**: reiniciar el backend y
cerrar y reabrir pgAdmin, porque `ALTER DATABASE ... SET` solo afecta a las
sesiones nuevas.

Ninguno de los tres cambia la forma de las tablas, así que no hace falta volver a
correr `prisma:pull` después.

## Orden recomendado

`11` primero (no tiene riesgo), luego `10`, y `09` cuando se haya decidido qué
hacer con los registros que ya tienen la fecha corrida.
