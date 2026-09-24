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

Hay dos caminos, y conviene no mezclarlos:

| Situación                                                   | Qué correr                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| **Entorno nuevo** (base recién creada, incluida `dmm_test`) | **Solo `scripts_bd_v4.sql`.** Ya trae todas las migraciones hasta la 29 |
| **Base existente** a la que le falta algún cambio           | Solo la migración que le falte, de esta carpeta                     |

El encabezado del v4 explica cómo crear la base, cambiar la clave de `dmm_app`
y dar de alta el primer administrador (el script no trae ningún usuario).

`scripts_bd_v3.sql` se conserva **solo como histórico**: ya no reproduce la base
vigente (ver «Qué pasó entre la 13 y la 28»). No lo use para montar entornos.

Aplicar una migración sobre una base creada con el v4 es redundante. Todas son
idempotentes (`CREATE OR REPLACE`, `IF NOT EXISTS`), así que no rompen nada, pero
es ruido innecesario.

**Los archivos de esta carpeta se conservan aunque ya estén aplicados.** Cada uno
documenta el problema que motivó el cambio, la solución y sus límites — un
contexto que no está en ningún otro sitio. `12` explica el razonamiento completo
del rol de mínimo privilegio; `13` describe un bug que afectó a beneficiarios
reales e incluye la consulta para encontrarlos y repararlos.

---

## Historial

De la 09 a la 13 están incorporadas al v3 y al v4; la 28 y la 29, solo al v4.

| Script                                    | Qué corrige                                                                                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `09_zona_horaria.sql`                     | La sesión de Postgres corría en GMT: entre las 18:00 y medianoche local, todo `CURRENT_DATE` grababa la fecha del día siguiente, y seis constraints que comparan contra `CURRENT_DATE` aceptaban como válida una fecha de mañana |
| `10_auditoria_sesion_sin_latido.sql`      | El 56% de `auditoria_log` era el refresco de `ultima_actividad` de cada petición                                                                                                                                                 |
| `11_indices_auditoria.sql`                | Faltaban los índices por los que filtra `GET /api/auditoria`                                                                                                                                                                     |
| `12_rol_aplicacion_minimo_privilegio.sql` | El backend conectaba como superusuario. Crea `dmm_app` sin `DELETE` ni DDL, y deja `auditoria_log` inalterable desde la aplicación vía `SECURITY DEFINER`                                                                        |
| `13_fix_recalculo_al_anular_entrega.sql`  | Al anular una entrega, la línea quedaba en `ENTREGADA` con 0 unidades: el beneficiario desaparecía de la lista de espera y el sistema lo daba por atendido                                                                       |
| `28_formato_cui_dpi.sql`                  | `persona.cui_dpi` aceptaba cualquier texto de hasta 13 caracteres, incluido `""`, que chocaba en el UNIQUE y esquivaba el trigger de menores. Ahora: 13 dígitos o NULL (hallazgo QA-12)                                                     |
| `29_tipos_documento_legibles.sql`         | Los tipos de documento se mostraban como `PARTIDA_NACIMIENTO` o `DPI_ENCARGADO`. Quedan con nombres legibles, y el DPI del encargado se divide en anverso y reverso como el del beneficiario |

### Qué pasó entre la 13 y la 28

Las migraciones **14 a 27 se aplicaron a mano y nunca llegaron a esta carpeta**
(los comentarios del código citan la 15, 17, 19, 22, 25, 26 y 27). Entre otras
cosas agregaron 17 tablas (formularios configurables, catálogos, estado civil,
ocupación, evidencias de contrato, `detalle_entrega_lote`), reestructuraron la
entrega (`fn_crear_entrega`, `sp_agregar_insumo_entrega`), el estado
`NO_DEVUELTO` y `motivo_cierre`, y afinaron los permisos de `dmm_app`.

Consecuencia (hallazgo QA-15): una base creada desde el repositorio no podía
registrar una entrega. `scripts_bd_v4.sql` se generó a partir de la base vigente
(`dmm_test`, idéntica a la de desarrollo en esquema y permisos) y se verificó
montando una base limpia solo con él y corriendo la suite completa del backend
contra ella.

Si alguien conserva los archivos originales de la 14 a la 27, agréguelos aquí:
documentan el porqué de cada cambio, que el v4 generado no puede contar.

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
`pnpm prisma:pull && pnpm prisma:generate`. La 28 y la 29 no lo requieren: un
CHECK o un cambio de datos no cambia el modelo de Prisma.

---

## Para agregar una migración nueva

La siguiente es la **30**.

1. Escribir el script con el problema medido, la solución y sus límites, como
   los anteriores. Idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`).
2. **Guardarlo en esta carpeta antes de aplicarlo en ningún lado.**
3. Aplicarlo en la base de desarrollo **y en `dmm_test`**.
4. **Incorporarlo al final de `scripts_bd_v4.sql`**, y actualizar la lista de
   migraciones de su encabezado.
5. Correr `corepack pnpm test`.

**Los pasos 2 y 4 son los que se olvidan, y son los que más caro salen**: así se
perdieron la 14 a la 27. Si una migración no llega al v4, los entornos nuevos
nacen sin ella mientras los existentes sí la tienen, y las dos versiones divergen en silencio hasta que alguien monta
una base limpia y descubre que el sistema se comporta distinto.
