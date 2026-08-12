# Migraciones SQL

Cambios de esquema y de configuración de la base de datos, en scripts numerados
y aplicados a mano. Continúa la numeración de los que el equipo ya tenía
(`06_sesiones.sql`, `07_genero_corto.sql` — obsoleta,
`08_fix_fn_auditoria_clave_compuesta.sql`).

**Nunca `prisma migrate` ni `prisma db push` sobre esta base.** El flujo del
proyecto es al contrario: el cambio se escribe en SQL plano, se aplica, y después
se corre `pnpm prisma:pull && pnpm prisma:generate` para que Prisma se ponga al
día.

---

## Cuándo usar esta carpeta y cuándo no

Desde que existe `scripts_bd_arreglada_v3.sql` hay dos caminos, y conviene no
mezclarlos:

| Situación                                                   | Qué correr                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| **Entorno nuevo** (base recién creada, incluida `dmm_test`) | **Solo el script v3.** Ya trae las cinco migraciones incorporadas |
| **Base existente** a la que le falta algún cambio           | Solo la migración que le falte, de esta carpeta                   |

Aplicar una migración sobre una base creada con el v3 es redundante. Todas son
idempotentes (`CREATE OR REPLACE`, `IF NOT EXISTS`), así que no rompen nada, pero
es ruido innecesario.

**Los archivos de esta carpeta se conservan aunque ya estén aplicados.** Cada uno
documenta el problema que motivó el cambio, la solución y sus límites — un
contexto que no está en ningún otro sitio. `12` explica el razonamiento completo
del rol de mínimo privilegio; `13` describe un bug que afectó a beneficiarios
reales e incluye la consulta para encontrarlos y repararlos.

---

## Historial

Las cinco están **aplicadas** en `dmm_usumatlan_db` y `dmm_test`, e incorporadas
al script v3.

| Script                                    | Qué corrige                                                                                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `09_zona_horaria.sql`                     | La sesión de Postgres corría en GMT: entre las 18:00 y medianoche local, todo `CURRENT_DATE` grababa la fecha del día siguiente, y seis constraints que comparan contra `CURRENT_DATE` aceptaban como válida una fecha de mañana |
| `10_auditoria_sesion_sin_latido.sql`      | El 56% de `auditoria_log` era el refresco de `ultima_actividad` de cada petición                                                                                                                                                 |
| `11_indices_auditoria.sql`                | Faltaban los índices por los que filtra `GET /api/auditoria`                                                                                                                                                                     |
| `12_rol_aplicacion_minimo_privilegio.sql` | El backend conectaba como superusuario. Crea `dmm_app` sin `DELETE` ni DDL, y deja `auditoria_log` inalterable desde la aplicación vía `SECURITY DEFINER`                                                                        |
| `13_fix_recalculo_al_anular_entrega.sql`  | Al anular una entrega, la línea quedaba en `ENTREGADA` con 0 unidades: el beneficiario desaparecía de la lista de espera y el sistema lo daba por atendido                                                                       |

### Notas sobre datos ya grabados

`09` y `13` corrigen el comportamiento futuro, **no los registros anteriores**.

- **`09`:** las filas grabadas antes de aplicarlo entre las 18:00 y medianoche
  hora local llevan la fecha corrida un día. Se detectan por la hora de
  `created_at` (Guatemala es UTC-6 fijo: un `created_at` entre 00:00 y 05:59 fue
  creado el día local anterior).
- **`13`:** puede haber líneas en `ENTREGADA` con `cantidad_entregada = 0`. El
  propio archivo trae la consulta para listarlas y el `SELECT` que las repara.
  **Revisar el listado antes de ejecutar la reparación.**

---

## Cómo aplicar una migración

```bash
corepack pnpm prisma db execute --file ./db/migraciones/NN_nombre.sql
```

O pegando el contenido en pgAdmin.

Dos avisos:

- Después de una migración que use `ALTER DATABASE ... SET` hay que
  **reconectar** (reiniciar el backend, cerrar y reabrir pgAdmin): solo afecta a
  sesiones nuevas.
- Las migraciones se corren con el **usuario dueño** de la base, no con
  `dmm_app`. Desde la `12`, ese rol no tiene privilegios de DDL, y eso es
  deliberado.

Si una migración cambia la forma de las tablas, después hay que correr
`pnpm prisma:pull && pnpm prisma:generate`. Ninguna de las cinco actuales lo
hace.

---

## Para agregar una migración nueva

La siguiente es la **14**.

1. Escribir el script con el problema medido, la solución y sus límites, como
   los anteriores.
2. Aplicarlo en `dmm_usumatlan_db` **y en `dmm_test`**.
3. **Incorporarlo al final de `scripts_bd_arreglada_v3.sql`**, y actualizar la
   lista de migraciones de su encabezado.
4. Correr `corepack pnpm test`.

**El paso 3 es el que se olvida, y es el que más caro sale.** Si una migración
no llega al script v3, los entornos nuevos nacen sin ella mientras los existentes
sí la tienen, y las dos versiones divergen en silencio hasta que alguien monta
una base limpia y descubre que el sistema se comporta distinto.
