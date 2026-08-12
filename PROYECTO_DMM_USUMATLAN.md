# Sistema DMM Usumatlán — Documento Maestro del Proyecto

> **Propósito:** contexto completo y autocontenido para orientar el desarrollo del backend, útil para retomar el trabajo en cualquier momento o desde otra conversación/IA.
>
> **Revisión:** actualizado al **esquema v3**, a las migraciones 09–13, al módulo centralizado de permisos y a la suite de **347 pruebas** en 12 archivos.

---

## 1. Contexto del proyecto

**Cliente:** Dirección Municipal de la Mujer (DMM) de Usumatlán, Zacapa, Guatemala.
**Objetivo:** digitalizar el control de beneficiarios, programas sociales, inventario/donaciones, entregas y reportes estadísticos (actualmente todo en papel).
**Metodología del proyecto (académico):** RUP — contexto de la entrega documental, no condiciona cómo se programa el backend.
**Equipo:** Mánleo Chacón, Luis Orozco, Jonathan Franco, Jose Pablo Quiej (Universidad Mariano Gálvez de Guatemala, Ingeniería en Sistemas).
**Repositorio backend:** `https://github.com/NahtanDevFS/dmm-backend.git`

### Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | Vite + **React 19** + **TypeScript**, React Router 7, React Hook Form + Zod, Axios |
| Backend | **Node.js + TypeScript 7**, **Express 5**, **Prisma 7** (`@prisma/client` + `@prisma/adapter-pg`) para CRUD/lecturas, **`pg` (Pool) directo** para todo lo transaccional/SPs, **Zod 4**, **bcrypt**, **cookie-parser**, **multer** + **sharp** + **file-type**, **helmet**, **express-rate-limit**, **exceljs** + **pdfkit** |
| Base de datos | **PostgreSQL** (script v3 + migraciones 09–13). Prisma en modo **`db pull`** (introspección) |
| Testing | **vitest** — 347 pruebas de integración contra base real, sin paralelismo |
| Gestor de paquetes | pnpm 11 |
| Módulos JS | **ESM real** (`"type": "module"` + `tsconfig` en `NodeNext`). Imports relativos requieren extensión `.js` |

**Prisma:** flujo `prisma db pull` → `prisma generate`. Cambios de estructura siempre en SQL plano primero. **Nunca `prisma migrate`/`db push`** sobre esta base.

**Variables de entorno en ESM:** en `NodeNext` los `import` estáticos se resuelven antes de ejecutar el punto de entrada, así que `dotenv.config()` dentro de `server.ts` corre demasiado tarde. Se precarga con `--import dotenv/config` en los scripts `dev`/`start` y en `setupFiles` de vitest, nunca dentro del código.

---

## 2. Roles del sistema

| Rol | Permisos |
|---|---|
| `EMPLEADO_DMM` | Operación diaria: beneficiarios, solicitudes, inventario, entregas, préstamos |
| `DIRECTORA` | Lo anterior más catálogos, aprobación/rechazo de solicitudes, multas y anulaciones |
| `ALCALDE` | **Solo reportes**, y los catálogos que alimentan sus filtros |
| `ADMINISTRADOR` | Todo, más gestión de usuarios y consulta de auditoría |

El catálogo `rol` tiene un `CHECK` (`rol_nombre_valido_check`) que solo permite estos 4 valores, sembrados de forma idempotente.

### El alcance de `ALCALDE` — resuelto

Durante una auditoría se detectó que cerca de **veinte endpoints de lectura de negocio** llevaban solo `requireAuth`, sin `requireRole`. Un `ALCALDE` autenticado accedía a solicitudes, entregas, contratos, inventario y —lo más delicado— a `GET /api/personas/:id/documentos`, es decir a los **DPI escaneados de beneficiarios** y a las evidencias fotográficas de entrega. La regla confirmada con el cliente decía que solo entra a reportes.

**Cerrado.** Todos esos endpoints usan hoy el conjunto `OPERACION`, que excluye a `ALCALDE`. La decisión y su verificación están en las secciones 9 y 11.

**Excepción deliberada:** `ALCALDE` **sí** lee `comunidades`, `departamentos`, `municipios`, `discapacidades`, `programas` y `categorias-insumo`. No es un olvido: son exactamente los seis catálogos que alimentan los filtros de sus reportes (`comunidadId`, `discapacidadId`, `programaId`, `categoriaId`). Sin ellos su único módulo queda inutilizable porque no puede poblar ni un `<select>`. Está verificado contra `reporte.schema.ts` y cubierto por pruebas.

### `rol` NO es un catálogo administrable

El documento de requisitos original (RF-CAT-01/06) trataba `rol` como catálogo con CRUD. **Se descartó**: cada rol tiene sus permisos codificados en el backend (`requireRole(...)`), así que un rol nuevo creado desde una pantalla no tendría ningún permiso real.

- No existe ni se construirá un CRUD de `rol`.
- `GET /api/roles` existe solo como lista para el `<select>` de gestión de usuarios, y por eso es **exclusivo de `ADMINISTRADOR`**.
- Cambiar el `rol_id` de un usuario vive en gestión de usuarios (Fase 8).
- RF-CAT-06 queda sin efecto práctico.

---

## 3. Requisitos del sistema

### 3.1 Requisitos funcionales

**Módulo SEG — Seguridad y Autenticación** *(completo)*
- RF-SEG-01: login con contraseña encriptada. **[Implementado]**
- RF-SEG-02: control de acceso por los 4 roles. **[Implementado y verificado con 205 pruebas]**
- RF-SEG-03: log de auditoría automático. **[Implementado]**

**Módulo BEN — Gestión de Beneficiarios** *(completo)*
- RF-BEN-01/07: registro y consulta de personas, edad calculada, menores con encargado, múltiples discapacidades, contacto libre para adultos sin DPI, jerarquía geográfica filtrable, múltiples documentos con archivo. **[Implementados]**

**Módulo PRO — Programas y Solicitudes** *(completo)*
- RF-PRO-01/04: cabecera + línea por insumo, 7 estados, cantidad parcial, cancelación con motivo, aprobación restringida a Dirección, recetas médicas, lista de espera. **[Implementados]**

**Módulo INV — Inventario y Donaciones** *(completo)*
- RF-INV-01/08 y RF-CAT-05: recepción de lotes, semáforo de caducidad, stock nunca negativo, insumos que bloquean solicitud sin stock, presentaciones múltiples con conversión por lote, código de fabricante condicional, baja por vencimiento. **[Implementados]**

**Módulo ENT — Entregas y Despachos** *(completo)*
- RF-ENT-01/06: entrega con descuento automático, FEFO/FIFO, préstamo de equipo, receptor distinto con parentesco, evidencia fotográfica. **[Implementados]**, más contratos con renovaciones y multas (pedido adicional del cliente).

**Módulo REP — Reportes y Estadísticas** *(completo)*
- RF-REP-01/06: beneficiados por fecha, edad, discapacidad y comunidad; exportación PDF/Excel; stock por categoría. **[Implementados]**

**Módulo CAT — Gestión de Catálogos** *(completo)*
- **CRUD por factory genérico (6):** `discapacidad`, `programa`, `institucion_donante`, `categoria_insumo`, `marca_insumo`, `unidad_medida`.
- **CRUD a medida:** `comunidad`.
- **Solo lectura:** `departamento`, `municipio`, `tipo_genero`, `tipo_parentesco`, `tipo_documento_persona`, `tipo_evidencia_entrega`, `tipo_multa_prestamo`, `estado_solicitud_apoyo`, `estado_contrato_prestamo`, `rol`.
- RF-CAT-02/03/04 implementados. ~~RF-CAT-06~~ sin efecto.

### 3.2 Requisitos no funcionales

| Código | Requisito | Estado |
|---|---|---|
| RNF-SEG-01 | Bcrypt, prohibido texto plano | **Implementado** |
| RNF-SEG-02 | HTTPS obligatorio | Pendiente (despliegue) |
| RNF-SEG-03 | Expiración por inactividad (30 min) | **Implementado y verificado (17 pruebas)** |
| RNF-SEG-04 | Queries parametrizadas | **Implementado** |
| RNF-REN-01 | Respuesta < 2s | A validar con carga real |
| RNF-REN-02 | Frontend para conexión limitada | Pendiente (frontend) |
| RNF-USA-01 | UI responsive | Pendiente (frontend) |
| RNF-USA-02 | Mensajes de error no técnicos | **Implementado** (7.5) |
| RNF-MAN-01 | Arquitectura limpia | **Implementado** en backend |
| RNF-MAN-02 | Backups automáticos diarios | Pendiente (infraestructura) |
| RNF-DIS-01 | Disponibilidad 99% | Pendiente (infraestructura) |

---

## 4. Modelo de datos

Referencia vigente: **script v3** — 39 tablas, 26 funciones, 7 procedimientos, 14 vistas, 85 triggers, 33 constraints `CHECK`, ~3,837 líneas. Más las migraciones 09–13.

### 4.1 ⚠️ El archivo del esquema está mal nombrado y no corre de corrido

**Pendiente de corregir. Léase antes de reconstruir cualquier entorno.**

**a) El archivo llamado `scripts_bd_arreglada_v2.sql` contiene en realidad el esquema v3.** Incluye `marca_insumo`, los flags ya movidos a `insumo`, `unidades_por_presentacion_lote` y el fix de `fn_auditoria`. Debe renombrarse a `scripts_bd_arreglada_v3.sql` **y versionarse en el repositorio**, donde hoy no está: `db/migraciones/` solo tiene las migraciones incrementales. Mientras siga viviendo en la máquina de una persona, es un punto único de fallo.

**b) La migración de los flags está duplicada, y la primera copia falla siempre.**

| Bloque | Líneas | Qué hace |
|---|---|---|
| **A** | 3228–3370 | `ALTER TABLE categoria_insumo DROP COLUMN ...` **sin soltar antes las vistas dependientes** |
| **B** | 3391–3564 | Versión corregida: hace `DROP VIEW` primero y recrea al final |

El bloque A revienta con `2BP01`. Con `psql -f` sin `ON_ERROR_STOP` el A hace rollback y el B corre limpio, pero **pegando el archivo en el Query Tool de pgAdmin el primer error detiene todo** y el entorno queda a medias. `fn_auditoria` además está definida dos veces (líneas 1264 y 3134); gana la segunda, que es la correcta, pero es ruido.

**Acción:** eliminar el bloque A y la primera definición de `fn_auditoria`.

### 4.2 Historial de cambios del esquema

**v1 → v2 (reemplazo completo con reset de la base).** Once cambios; los que afectaron al backend: `parentesco` de texto a FK en `encargado_menor` y `entrega`; eliminación de `persona.documento_identificacion` y `contacto_responsable` (→ `documento_persona` y `contacto_referencia_persona`); `recepcion_donacion_lote.documento_respaldo` → tabla `documento_recepcion`; eliminación de `asignacion_pendiente`; división de `solicitud_apoyo` en cabecera + línea; tabla nueva `receta_medica`; `persona.genero` → FK a `tipo_genero`; tablas nuevas `tipo_multa_prestamo` y `multa_prestamo`.

**v2 → v3 (incremental, ya dentro del script).**

1. **Los tres flags se movieron de `categoria_insumo` a `insumo`**: `requiere_fecha_caducidad`, `requiere_codigo_fabricante`, `bloquea_solicitud_sin_stock`. En consecuencia `categoria_insumo` pasó a ser un catálogo simple más.
2. `insumo.es_perecedero` eliminado (redundante).
3. Unicidad de `insumo` = `(nombre, categoria_id)`.
4. `presentacion_insumo.factor_a_base` eliminado → conversión **por lote** en `detalle_inventario_lote.unidades_por_presentacion_lote`. Permite que el mismo insumo llegue en frascos de 50 y de 100 ml.
5. Índice único parcial `idx_presentacion_default_unica`: una sola presentación por defecto por insumo.
6. Tabla nueva **`marca_insumo`** + `detalle_inventario_lote.marca_id`. La marca es dato del **lote**, no del insumo.
7. Fix de `fn_auditoria` para claves primarias compuestas (4.3).

### 4.3 `fn_auditoria()` y las claves primarias compuestas

Asumía `COALESCE(NEW.id, OLD.id)`, lo que rompía con `encargado_menor` y `persona_discapacidad` (`record "new" has no field "id"`). Corregido con un `CASE` por `TG_TABLE_NAME`: esas dos usan `menor_id` y `persona_id` como `registro_id`. El JSON de auditoría sigue conteniendo ambos ids.

**Cualquier tabla nueva con clave compuesta necesita su entrada en ese `CASE`**, o fallará igual.

Desde la migración 12, `fn_auditoria` es además **`SECURITY DEFINER`** con `search_path` fijado (ver 8.4).

### 4.4 Dominios de tablas

Seguridad/auditoría (`rol`, `usuario`, `sesion`, `tipo_accion_auditoria`, `auditoria_log`) · Geografía (`departamento`→`municipio`→`comunidad`) · Beneficiarios (`persona`, `discapacidad`, `persona_discapacidad`, `encargado_menor`, `tipo_parentesco`, `tipo_genero`, `contacto_referencia_persona`, `tipo_documento_persona`, `documento_persona`) · Programas/solicitudes (`programa`, `estado_solicitud_apoyo`, `solicitud_apoyo`, `detalle_solicitud_apoyo`, `receta_medica`) · Inventario (`institucion_donante`, `unidad_medida`, `categoria_insumo`, `marca_insumo`, `insumo`, `presentacion_insumo`, `recepcion_donacion_lote`, `documento_recepcion`, `detalle_inventario_lote`) · Entregas y préstamos (`entrega`, `detalle_entrega`, `estado_contrato_prestamo`, `contrato_prestamo`, `tipo_multa_prestamo`, `multa_prestamo`, `tipo_evidencia_entrega`, `evidencia_entrega`).

Todas (salvo `auditoria_log`) tienen `activo`, `created_at`, `updated_at`, `created_by`, `updated_by`.

### 4.5 Datos semilla

| Catálogo | Valores |
|---|---|
| `rol` | `EMPLEADO_DMM`, `DIRECTORA`, `ALCALDE`, `ADMINISTRADOR` |
| `tipo_accion_auditoria` | `INSERT`, `UPDATE`, `DELETE` |
| `estado_solicitud_apoyo` | `PENDIENTE_ADQUISICION`, `PENDIENTE_ENTREGA`, `PENDIENTE_ENTREGA_PARCIAL`, `APROBADA`, `RECHAZADA`, `ENTREGADA`, `CANCELADA` |
| `estado_contrato_prestamo` | `VIGENTE`, `DEVUELTO`, `VENCIDO`, `EXTENDIDO` |
| `tipo_genero` | `MASCULINO`, `FEMENINO`, `OTRO`, `PREFIERE_NO_DECIR` |
| `tipo_parentesco` | `MADRE`, `PADRE`, `HIJO_A`, `HERMANO_A`, `ABUELO_A`, `TIO_A`, `CONYUGE`, `OTRO` |
| `tipo_documento_persona` | `DPI`, `PARTIDA_NACIMIENTO`, `DPI_ENCARGADO`, `OTRO` |
| `tipo_evidencia_entrega` | `FOTO_BENEFICIARIO_CON_INSUMO`, `FOTO_RECEPTOR`, `FOTOCOPIA_DPI_RECEPTOR`, `OTRO` |
| `tipo_multa_prestamo` | `RETRASO_DEVOLUCION` (Q50), `EQUIPO_DANADO` (Q100) |

**El orden de siembra importa:** `tipo_accion_auditoria` va **primero**. Cada tabla auditada tiene un trigger `AFTER INSERT` que resuelve `tipo_accion_id` buscando `TG_OP` en ese catálogo; si está vacío, el `SELECT` da `NULL` y **ninguna escritura del sistema funciona**. Está replicado en `tests/helpers/bd.ts`.

---

## 5. Reglas de negocio en la base de datos

**El backend NO reimplementa esta lógica; la orquesta e interpreta.**

**Triggers de validación:** `fn_validar_menor_encargado` (`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` sobre `persona` y `encargado_menor`), `fn_validar_stock_linea_solicitud`, `fn_calcular_recepcion_lote`, `fn_calcular_cantidad_entregada` + `fn_descontar_inventario` (con `FOR UPDATE`), `fn_restaurar_inventario`.

**Triggers de cálculo:** `fn_estado_inicial_linea_solicitud`, `fn_actualizar_linea_desde_entrega`, `fn_recalcular_linea_solicitud`, `fn_recalcular_cabecera_solicitud`, `fn_set_updated_at`, `fn_auditoria`.

**Auditoría — CRÍTICO:** el backend inyecta `SET LOCAL app.usuario_id` (vía `withUserTransaction`) en cada transacción de escritura. Verificado end-to-end.

**Los 7 stored procedures, todos en uso y todos cubiertos por pruebas:**

| Procedimiento | Firma | Invocado desde |
|---|---|---|
| `sp_registrar_entrega` | 8 params | `entrega.repository.ts` |
| `sp_desactivar_entrega` | `(entrega_id, usuario_id, motivo)` | `entrega.repository.ts` |
| `sp_procesar_donacion_pendientes` | `(insumo_id, recepcion_lote_id)` | `recepcion.repository.ts` |
| `sp_dar_baja_insumo_vencido` | 3 | `recepcion.repository.ts` |
| `sp_cancelar_linea_solicitud` | 3 | `solicitud.repository.ts` |
| `sp_cancelar_solicitud_completa` | 3 | `solicitud.repository.ts` |
| `sp_registrar_devolucion_prestamo` | `(contrato_id, usuario_id)` | `contrato.repository.ts` |

**`sp_procesar_donacion_pendientes` NO es automático** — el backend lo invoca explícitamente tras cada `INSERT` en `detalle_inventario_lote`, en la misma transacción. Y **no descuenta inventario**: solo marca líneas como listas para entrega. El descuento físico ocurre al despachar; si descontara aquí, el stock se restaría dos veces.

**Funciones auxiliares:** `fn_calcular_edad`, `fn_edad_en_fecha`, `fn_es_menor`, `fn_es_adulto_mayor` (65), `fn_stock_disponible`, `fn_semaforo_caducidad`, `fn_convertir_a_base` (**obsoleta desde v3**, sin consumidor).

**Vistas:** `v_inventario_lote_fifo`, `v_stock_insumo`, `v_stock_insumo_presentaciones`, `v_semaforo_inventario`, `v_lista_espera`, `v_persona_edad` (**sin consumidor**), `v_reporte_personas_atendidas`, `v_solicitudes_activas`, `v_reporte_stock_por_categoria`, `v_reporte_poblacion_beneficiada`.

### 5.1 Reglas del backend que conviene tener presentes

- **Solicitudes:** los estados de las líneas los asigna la base según stock real. **Aprobar no cambia `estado_id`**: `aprobada` es columna aparte. Si un insumo con `bloquea_solicitud_sin_stock` no tiene existencias → 409 **sin cabecera huérfana**.
- **Entregas:** la base elige lotes por **FEFO con respaldo FIFO** (caducidad más próxima; los sin caducidad al final, mediante `+100 years` en `v_inventario_lote_fifo`). Anular devuelve **a cada lote de origen**, no a un total agregado. Si el lote fue dado de baja, **no** se restaura y se emite un `WARNING`: devolver unidades a un lote vencido inflaría el inventario con producto inservible.
- **Préstamos:** un contrato nace de un renglón de entrega o es renovación de otro, **nunca ambas** (`contrato_origen_check`). La cadena es **lineal**: un contrato admite **una sola** renovación (`contrato_prestamo_anterior_unico_key`). Solo el contrato raíz tiene `detalle_entrega_id`, así que `sp_registrar_devolucion_prestamo` **solo opera sobre él** y el backend resuelve la raíz con un CTE recursivo antes de invocarlo.
- **`vencidos` se calcula por fechas, no por `estado_id`**: nada en la base mueve ese estado solo. `POST /api/contratos/marcar-vencidos` lo sincroniza (pensado para un cron).
- **Multas:** sin `monto` se toma el `monto_sugerido` del tipo. "Anular" es `activo = false`.
- **Recepción:** el backend **no envía** `cantidad_inicial` ni `cantidad_disponible`; un trigger las calcula como `FLOOR(cantidad × unidades_por_presentacion_lote)`. Trunca, no redondea.

---

## 6. Casos de uso documentados

Formato tabla RUP: **Iniciar sesión** (con flujos alternativos A1 credenciales incorrectas / A2 usuario inactivo), **Ver/Editar/Desactivar beneficiarios**. Guía de UX y de redacción de errores (RNF-USA-02).

---

## 7. Arquitectura de acceso a datos

### 7.1 Prisma vs. `pg` directo

**Prisma** — CRUD simple y lecturas sin auditoría. **`pg.Pool` directo** — cualquier SP, o INSERT/UPDATE auditable.

**Patrón obligatorio** (`src/db/withUserTransaction.ts`): `BEGIN` → `set_config('app.usuario_id', ..., true)` → trabajo → `COMMIT`/`ROLLBACK` → `client.release()` en `finally`.

**Regla dura:** ninguna escritura auditable pasa por `prisma.<modelo>.create/update/delete`. **Verificado: cero ocurrencias en todo `src/`.**

### 7.2 Estructura de carpetas

```
src/
  config/roles.ts       → matriz de autorización (sección 9)
  db/                   prisma.ts / pool.ts / withUserTransaction.ts
  lib/
    errores/postgres.ts    → interceptor de errores de BD (7.5)
    paginacion.ts          → sobre uniforme de listados (7.7)
    reportes/exportar.ts   → xlsx y pdf
    rutas-protegidas.ts    → guarda de arranque (sección 9)
    storage/               → file-validation, storage.service, upload.middleware, archivos.routes
  middlewares/          auth / role / error / rate-limit
  modules/              auth, catalogos, catalogos-lectura, geografia, comunidades,
                        personas, insumos, inventario, solicitudes, entregas,
                        prestamos, reportes, auditoria, usuarios
  routes/routes.ts
  app.ts / server.ts
db/migraciones/         → 09 a 13 + README
docs/API.md             → referencia de endpoints
tests/                  → 12 archivos, 347 pruebas (sección 11)
```

`docs/API.md` es la referencia de contrato de endpoints; este documento describe decisiones y reglas.

### 7.3 CRUD genérico para catálogos simples

`catalogo-simple.config.ts` mapea cada catálogo a su modelo Prisma, tabla real, dependencias que bloquean la desactivación (RF-CAT-03) con su mensaje, y **`rolesLectura`**. Agregar un catálogo que encaje es una entrada de configuración.

- **Cubiertos (6):** `discapacidad`, `programa`, `categoria_insumo`, `marca_insumo`, `unidad_medida`, `institucion_donante`.
- `tieneDescripcion` es bandera por catálogo (solo `programa` la tiene). Las `dependencias` se evalúan en orden: gana el primer bloqueo, así que conviene poner primero la más explicativa.
- Las respuestas **no incluyen** columnas de auditoría, por decisión explícita.

### 7.4 Contrato de endpoints (catálogos)

```
GET    /api/<recurso>                  lista (?incluirInactivos=true)
GET    /api/<recurso>/:id              detalle
POST   /api/<recurso>                  crear                    [DIRECCION]
PATCH  /api/<recurso>/:id              editar                   [DIRECCION]
PATCH  /api/<recurso>/:id/desactivar   RF-CAT-03 con motivo     [DIRECCION]
PATCH  /api/<recurso>/:id/reactivar    RF-CAT-04                [DIRECCION]
```

Desactivar devuelve **409** si hay dependientes activos.

### 7.5 Interceptor de errores de Postgres

`src/lib/errores/postgres.ts`. Mapea **23 constraints por nombre** (todas verificadas contra el script) y traduce por código: `23503`→400, `23502`→400, `23514`/`23505`/`23P01`→400/409. `P0001` (excepciones de triggers, ya en español) se devuelven tal cual con 400 o 409 según el caso. `humanizarMensajeTrigger` sustituye ids por nombres.

### 7.6 Manejo de archivos

Almacenamiento local en disco, con `multer` + `sharp` + `file-type`. Utilidad compartida en `src/lib/storage/`, usada desde cada módulo (no un endpoint genérico de subida, que produciría archivos huérfanos).

**Capas de seguridad:**
1. Límite de 8 MB.
2. **Validación por firma binaria real** (magic bytes), no por extensión ni `Content-Type` — ambos los controla quien sube. Lista blanca: JPEG, PNG, WEBP, PDF.
3. Toda imagen se **recomprime siempre** (máx. 1600 px, JPEG 80): descarta payloads incrustados en metadatos.
4. Nombres en disco **siempre UUID generado por el servidor**.
5. Se sirven vía `GET /api/archivos/*rutaArchivo`, con `requireAuth` + `requireRole(OPERACION)`.

**Categorías (`CategoriaArchivo`):** `documentos-persona`, `evidencia-entrega`, `recetas-medicas`, `documentos-recepcion`, `contratos-prestamo`.

**Dos bugs reales corregidos (Windows):**
- **Wildcard de Express 5.** `router.get("/archivos/*", ...)` tumba el servidor con `PathError`: Express 5 exige wildcards con nombre. Corregido a `"/archivos/*rutaArchivo"`, y el valor llega como **array** de segmentos.
- **Rutas relativas vs. absolutas.** `UPLOADS_DIR` llega como `./uploads`; `path.join()` elimina el `./`, así que `startsWith` daba `false` y **toda** descarga fallaba con 400. Corregido con `path.resolve()` en ambos lados.

### 7.7 Paginación uniforme

```json
{ "total": 240, "limite": 50, "desplazamiento": 0, "hay_mas": true, "datos": [ ... ] }
```

`?limite=` (1–200, por defecto 50) y `?desplazamiento=`. Paginan los listados de negocio. **No paginan**, por decisión: catálogos de selección, sub-recursos de una ficha, y reportes (se consumen enteros para exportar).

---

## 8. Autenticación, sesiones y privilegios de base de datos

### 8.1 Sesión con estado, no JWT puro

RNF-SEG-03 exige expiración por **inactividad**, que con JWT stateless no se valida en servidor sin reintroducir estado. Se descartó "access + refresh token": controlar inactividad en el frontend no es garantía, y la escala (una municipalidad) no justifica rotación ni Redis.

### 8.2 Tabla `sesion`

**Nunca se eliminan filas** (evidencia de acceso). Sin columna `activo`. Columnas clave: `token_hash` (SHA-256 — el token es aleatorio de 256 bits, no una contraseña humana), `ultima_actividad`, `expira_en` (tope absoluto de **12 h**, decisión de diseño propia), `revocada_en`.

Constraint a tener en cuenta: **`sesion_expira_en_valida_check` exige `expira_en > created_at`** — una sesión no puede nacer expirada. Para simular caducidad hay que envejecer la fila completa.

### 8.3 Flujo implementado

- `POST /api/auth/login` — Bcrypt, cookie `dmm_session` (HttpOnly + Secure en prod + SameSite=Strict, 12 h). Con rate limit propio.
- `POST /api/auth/logout` — revoca, idempotente.
- `GET /api/auth/me` — necesario para recuperar la sesión al recargar (la cookie es HttpOnly).
- `requireAuth` — sesión existe → no revocada → dentro del tope absoluto → dentro de los 30 min de inactividad. Refresca `ultima_actividad` con un mínimo entre latidos.

**Asimetría deliberada en el login:** contraseña incorrecta y usuario inexistente devuelven **401 idéntico** (evita enumeración de cuentas), pero un usuario **desactivado** recibe **403** con mensaje propio. Quien llega ahí ya demostró conocer la contraseña, así que no se revela nada nuevo; a cambio el empleado sabe que debe hablar con el administrador en vez de reintentar.

**No hay registro público.** El primer Administrador se crea por SQL con el hash ya generado.

### 8.4 Rol de base de datos de mínimo privilegio (migración 12)

El backend conectaba como superusuario. Quien obtuviera el `DATABASE_URL` podía borrar filas, tirar tablas, **desactivar los triggers de auditoría** y escribir directamente en `auditoria_log`. Nada de eso es necesario para operar.

`dmm_app` no tiene: `DELETE` en ninguna tabla (el sistema usa borrado lógico en todas partes — verificado: **no existe un solo `DELETE` físico** en la base ni en el backend), DDL, ni escritura sobre `auditoria_log`.

**`fn_auditoria` es `SECURITY DEFINER`** con `SET search_path = public, pg_temp`. Sin eso, revocarle `INSERT` sobre `auditoria_log` dejaría al sistema sin poder escribir nada. Con eso, **la bitácora solo se escribe a través del trigger**: ni la aplicación ni nadie con la cadena de conexión puede forjar ni borrar entradas. Es lo que hace que la auditoría signifique algo.

**Esto NO mapea los roles de negocio a roles de Postgres.** Esa autorización vive en el backend y debe vivir en un solo lugar; duplicarla crearía dos fuentes de verdad que se desincronizan.

#### ⚠️ La propiedad se salta los `GRANT`

**Verificar seguridad con `has_table_privilege` no basta.** El **dueño** de una tabla puede hacer `DROP`, `ALTER` y `DISABLE TRIGGER` sin importar cuántos `REVOKE` se apliquen, y `has_table_privilege` devuelve `false` para un dueño. Igual, quien sea dueño de la **base** hereda `pg_database_owner`, que es dueño del esquema `public`, y conserva `CREATE` pase lo que pase.

**Regla:** el esquema se crea siempre con el usuario dueño (`postgres`), **nunca con `dmm_app`**. Lo mismo para la base de pruebas: montarla con `dmm_app` le dio propiedad sobre las tablas que creó, y con ella capacidad de DDL que en producción no tiene — una base de pruebas que otorga más privilegios que producción produce pruebas que mienten.

Verificación periódica (cubierta por `tests/negocio/permisos-bd.test.ts`):

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner='dmm_app';
SELECT has_schema_privilege('dmm_app','public','CREATE');
SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database();
```

Lo correcto es: sin tablas, `false`, y dueño `postgres`.

---

## 9. Autorización: matriz centralizada y guarda de arranque

### 9.1 `src/config/roles.ts` — única fuente de verdad

Antes, cada archivo de rutas declaraba su propio `ROLES_GESTION`, y **el mismo identificador significaba dos cosas distintas** según el archivo: en `insumo` y `catalogo-simple` era `[DIRECTORA, ADMINISTRADOR]`, y en `persona`, `entregas`, `solicitudes` y `prestamos` era `[EMPLEADO_DMM, DIRECTORA, ADMINISTRADOR]`. Nadie leyendo un archivo suelto podía saber cuál le tocaba. Esa ambigüedad es la causa estructural del problema de `ALCALDE`.

Los conjuntos se nombran **por intención**, no por quién los compone:

| Conjunto | Miembros | Para qué |
|---|---|---|
| `TODOS` | los 4 | Lo que no expone datos de negocio |
| `OPERACION` | Empleado, Directora, Admin | Beneficiarios, inventario, solicitudes, entregas, préstamos, archivos |
| `DIRECCION` | Directora, Admin | Catálogos, aprobar/rechazar, anular, multas |
| `REPORTES` | Directora, **Alcalde**, Admin | Único módulo del Alcalde; sin endpoints de escritura |
| `LECTURA_CATALOGOS_REPORTE` | los 4 | Los 6 catálogos que alimentan filtros de reportes |
| `SOLO_ADMIN` | Admin | Usuarios, auditoría, `GET /api/roles` |

### 9.2 Guarda de arranque (`src/lib/rutas-protegidas.ts`)

Recorre el router al importar `app.ts` y **falla el arranque** si alguna ruta no declara roles. Olvidar un `requireRole` deja de ser un agujero silencioso en producción y pasa a ser un error visible en `pnpm dev`.

Cada ruta lleva `requireRole(...)` o `permitirSinRol("motivo")`. **No hay lista de excepciones**: la exención se declara en la propia ruta, donde la ve quien revisa el cambio. Las cuatro actuales: `POST /login`, `POST /logout`, `GET /me`, `PATCH /usuarios/mi-password`.

Estado verificado: **148 rutas — 144 con rol declarado, 4 exentas con motivo, 0 desprotegidas.**

Detalle técnico: la guarda **no reconstruye la ruta HTTP completa** porque Express 5 no expone la ruta de montaje de un sub-router (`layer.path` es `undefined` hasta que entra una petición). Un primer intento que sí lo hacía "pasaba" sin verificar nada.

### 9.3 Matriz de acceso

| Módulo | EMPLEADO_DMM | DIRECTORA | ALCALDE | ADMINISTRADOR |
|---|---|---|---|---|
| Auth (login/logout/me) | ✅ | ✅ | ✅ | ✅ |
| Catálogos de filtros de reporte | ✅ | ✅ | ✅ | ✅ |
| Otros catálogos — lectura | ✅ | ✅ | — | ✅ |
| Catálogos — gestión | — | ✅ | — | ✅ |
| Beneficiarios y sus documentos | ✅ | ✅ | — | ✅ |
| Insumos, inventario, recepciones | ✅ | ✅ | — | ✅ |
| Solicitudes — lectura y gestión | ✅ | ✅ | — | ✅ |
| Solicitudes — aprobar/rechazar | — | ✅ | — | ✅ |
| Entregas — registrar | ✅ | ✅ | — | ✅ |
| Entregas — anular | — | ✅ | — | ✅ |
| Préstamos — gestión | ✅ | ✅ | — | ✅ |
| Multas | — | ✅ | — | ✅ |
| Archivos (`/api/archivos/*`) | ✅ | ✅ | — | ✅ |
| Reportes | — | ✅ | ✅ | ✅ |
| Gestión de usuarios y `/api/roles` | — | — | — | ✅ |
| Auditoría | — | — | — | ✅ |

---

## 10. Seguridad — checklist

- [x] Bcrypt (coste 12). Mínimo 8 caracteres con letra y número.
- [ ] HTTPS obligatorio — pendiente despliegue.
- [x] Expiración de sesión por inactividad, validada en servidor.
- [x] Queries parametrizadas.
- [x] Validación Zod en cada endpoint.
- [x] Ninguna escritura auditable pasa por Prisma.
- [x] Rate limiting — login: 10 intentos fallidos por IP+usuario cada 15 min (`skipSuccessfulRequests`, con `ipKeyGenerator` para que IPv6 no lo evada; combinar IP y usuario evita que una salida NAT bloquee a toda la municipalidad). General: 300/min.
- [x] `helmet` (con `crossOriginResourcePolicy: cross-origin`; CSP desactivada por ser API sin HTML).
- [x] `trust proxy = 1`.
- [x] Límite de cuerpo de 1 MB.
- [x] CORS restrictivo (`credentials: true` + origen explícito, nunca `*`).
- [x] Archivos validados por firma binaria y recomprimidos.
- [x] Interceptor de errores de Postgres.
- [x] Redacción de credenciales en auditoría (`password_hash`, `token_hash` → `[redactado]`).
- [x] Guardas de gestión de usuarios: no cambiarse el propio rol, no autodesactivarse, no tocar al único `ADMINISTRADOR` activo.
- [x] **Alcance de `ALCALDE` cerrado** y verificado con pruebas.
- [x] **Rol de BD de mínimo privilegio** (migración 12).
- [x] **Auditoría inalterable** desde la aplicación (`SECURITY DEFINER`).
- [x] **Guarda de arranque** contra rutas sin declarar roles.
- [ ] Logs de aplicación separados de `auditoria_log` — no formalizado (hoy `console.error`).
- [ ] Backups automáticos — pendiente infraestructura.

---

## 11. Testing

**347 pruebas en 12 archivos.** Runner: **vitest** sin paralelismo (`fileParallelism: false`), con `dotenv/config` + `tests/setup.ts` en `setupFiles`.

### 11.1 Por qué son de integración

La lógica de negocio **no está en TypeScript**: está en 7 triggers, 7 procedimientos, 33 constraints `CHECK` y 26 funciones PL/pgSQL. Los repositorios son en buena medida invocadores. **La cobertura de líneas de TS sería una métrica engañosa aquí**: se podría llegar al 90% sin haber probado un solo trigger. Por eso se prueba contra base real y se cubre primero donde el fallo cuesta más caro.

### 11.2 Infraestructura

**Base de pruebas separada (`dmm_test`)**, montada igual que producción. Dos conexiones a propósito:

| Variable | Usuario | Para qué |
|---|---|---|
| `DATABASE_URL_TEST` | `dmm_app` | Todo lo que ejerce el código bajo prueba |
| `DATABASE_URL_TEST_OWNER` | dueño | Solo preparar y limpiar |

Así cualquier `GRANT` que falte aparece como prueba rota y no como error en producción. El reset con el dueño es **necesario**, no cómodo: desde la migración 12 la aplicación no puede borrar nada.

Salvaguardas en `tests/helpers/bd.ts`: el nombre de la base debe contener `test` o se aborta; `tests/setup.ts` reasigna `DATABASE_URL` antes de que ningún módulo la lea; las semillas de catálogos se reponen en cada reset (con `tipo_accion_auditoria` primero).

**`usuario` NO se trunca.** Las 76 FKs `created_by`/`updated_by` apuntan ahí, y `TRUNCATE ... CASCADE` se propaga hacia las tablas que **referencian** a la truncada: incluirla vacía la base entera, catálogos incluidos.

### 11.3 Qué cubre cada archivo

| Archivo | Casos | Qué garantiza |
|---|---|---|
| `acceso-por-rol` | 205 | 41 endpoints × 4 roles + sin sesión |
| `matriz-declarada` | 3 | Ninguna ruta sin roles; exentas acotadas (sin BD, ~5 ms) |
| `negocio/inventario` | 13 | Cálculo de lote, validaciones condicionales, descuento, **concurrencia sobre el mismo lote** |
| `negocio/entregas` | 15 | FEFO/FIFO, encadenado entre lotes, validaciones, **anulación que devuelve a cada lote de origen** |
| `negocio/solicitudes` | 10 | Estado inicial por stock, bloqueo de insumos críticos |
| `negocio/lista-espera` | 17 | Reparto por antigüedad, recálculo de línea y cabecera, **regresión al anular** |
| `negocio/prestamos` | 18 | `contrato_origen_check`, renovación única, devolución sobre la raíz, multas |
| `negocio/beneficiarios` | 14 | RF-BEN-03 con validación **diferida al COMMIT**, límite de los 18 años |
| `negocio/permisos-bd` | 14 | Propiedad, `DELETE`, `CREATE`, auditoría inalterable, `SECURITY DEFINER` |
| `seguridad/archivos` | 16 | Firma binaria, normalización, nombres UUID, path traversal |
| `seguridad/sesiones` | 17 | Inactividad, tope absoluto, revocación, credenciales |
| `with-user-transaction` | 5 | `app.usuario_id` llega a la base, rollback, retorno al pool |

### 11.4 Hallazgos de las pruebas

**Bug real corregido — regresión de estado al anular una entrega (migración 13).** `fn_recalcular_linea_solicitud` conservaba el estado cuando el total entregado volvía a 0, así que una línea anulada quedaba en `ENTREGADA` con **cero unidades entregadas**. Como `v_lista_espera` solo muestra `PENDIENTE_ADQUISICION` y `PENDIENTE_ENTREGA_PARCIAL`, esa persona **desaparecía de toda lista de pendientes**, y como la cabecera cuenta `ENTREGADA` como línea cerrada, la solicitud entera se marcaba como atendida. Efecto práctico: se registra una entrega por error, se anula, y el beneficiario queda fuera del sistema como si ya hubiera recibido su insumo, en silencio.

La cabecera tenía el mismo hueco. Ambas funciones corregidas en `13_fix_recalculo_al_anular_entrega.sql`, respetando los estados terminales por decisión humana (`CANCELADA`, `RECHAZADA`, `APROBADA`). **El script incluye la consulta para encontrar y reparar líneas ya afectadas.**

**Bug corregido — `datos` faltante en `encargadoSchema`.** El schema de `persona` descartaba silenciosamente el objeto `datos`, que `persona.repository` lee al crear y al vincular encargados: rompía el alta de menor sin DPI con encargado nuevo (RF-BEN-03).

**Diferencias de diseño descubiertas, no bugs:** el 403 del usuario desactivado (8.3) y que `sp_registrar_devolucion_prestamo` rechace las renovaciones a propósito.

### 11.5 Qué falta

Filtros de reportes, mensajes del interceptor de errores, paginación. Todo de bajo riesgo.

---

## 12. Plan de trabajo — estado

| Fase | Estado |
|---|---|
| **0 — Setup** | ✅ |
| **1 — Auth** | ✅ |
| **2 — Catálogos y geografía** | ✅ |
| **3 — Beneficiarios** | ✅ |
| **4 — Inventario** | ✅ |
| **5 — Solicitudes** | ✅ |
| **6 — Entregas y préstamos** | ✅ |
| **7 — Reportes** | ✅ |
| **8 — Auditoría y administración** | ✅ |
| **9 — Hardening** | ✅ |
| **10 — Permisos y pruebas** | ✅ Matriz centralizada, guarda de arranque, rol de BD, 347 pruebas |

### Trabajo pendiente

1. **Corregir y versionar el script v3** (4.1) — renombrar, quitar el bloque duplicado, subirlo al repo.
2. **Revisar datos afectados por el bug de anulación** en la base real (consulta al final de la migración 13).
3. Ampliar pruebas de reportes y errores.
4. Despliegue: HTTPS, backups, logs de aplicación.
5. Frontend.

---

## 13. Flujo de trabajo con Git y GitHub

Ramas: `main` (estable), `develop` (integración), `feature/*`, `fix/*`, `chore/*`. Conventional Commits. PR con base `develop`, ≥1 aprobación, **Squash and merge**.

**Ramas mergeadas:** `chore/setup-esm-zod-env`, `feature/auth-login-sesiones`, `feature/catalogos-crud`, `feature/geografia-comunidades`, `feature/categoria-insumo`, `feature/beneficiarios`, `feature/esquema-v2-catalogos-persona`, `feature/uploads-documento-persona`, `feature/insumos-presentaciones`, `feature/recepcion-donaciones`, `feature/solicitudes-apoyo`, `feature/entregas`, `feature/prestamos-multas`, `feature/reportes`, `feature/gestion-usuarios`, `feature/auditoria-consulta`, `chore/hardening`, `feature/roles`, `feature/tests`.

---

## 14. Notas y advertencias para quien continúe

**Base de datos**

- **El archivo `scripts_bd_arreglada_v2.sql` es en realidad el v3 y no corre de corrido en pgAdmin.** Leer 4.1 antes de reconstruir un entorno.
- **Crear el esquema siempre con el usuario dueño, nunca con `dmm_app`** (8.4). La propiedad se salta los `GRANT`.
- **El esquema fue reemplazado una vez (v1→v2) y luego extendido (v2→v3).** Confirmar la forma de cualquier tabla contra el script vigente o un `schema.prisma` recién introspeccionado.
- **No duplicar en TypeScript** la lógica de triggers/SPs.
- **`app.usuario_id` en cada transacción auditable**, siempre vía `withUserTransaction`.
- **`sp_procesar_donacion_pendientes` NO es automático**, y **no descuenta inventario**.
- **Tablas con clave primaria compuesta requieren entrada explícita en el `CASE` de `fn_auditoria()`.**
- **Sembrar `tipo_accion_auditoria` antes que cualquier otro catálogo** (4.5).
- **Zona horaria:** aplicada en `dmm_usumatlan_db` (`America/Guatemala`). Sin ella, seis constraints que comparan contra `CURRENT_DATE` aceptan como válida una fecha de mañana después de las 18:00.

**Modelo (v3)**

- **Los tres flags viven en `insumo`, no en `categoria_insumo`.**
- **`presentacion_insumo` ya no tiene `factor_a_base`**; la conversión es por lote.
- **`marca_insumo` se vincula por lote**, no por insumo.
- **`persona.genero_id`** es FK a `tipo_genero` con valores largos. La migración `07_genero_corto.sql` está **obsoleta**, no aplicar nunca.
- **`rol` no es administrable.**
- **`fn_convertir_a_base` y `v_persona_edad` no tienen consumidor.**

**Trampas técnicas ya pagadas**

- **⚠️ Prisma introspecciona `insumo → presentacion_insumo` como relación 1:1**, no 1:N, por el índice único parcial `idx_presentacion_default_unica`. Hoy no explota porque ese repositorio usa `pg` directo, pero `prisma.insumo.findUnique({ include: { presentacion_insumo: true } })` devolvería **una sola presentación**. Leer desde `presentacion_insumo` hacia arriba.
- **Express 5 exige wildcards con nombre** y devuelve un array de segmentos (7.6).
- **Rutas desde variables de entorno: siempre `path.resolve()` antes de comparar prefijos.**
- **ESM: precargar `dotenv` con `--import`**, nunca `dotenv.config()` en el código.
- **`sesion_expira_en_valida_check` exige `expira_en > created_at`** (8.2).
- **`$n` de Postgres no se reutiliza entre columnas de distinto tipo**: un mismo parámetro para `numeric` e `integer` falla con `inconsistent types deduced for parameter`.
- **Búsqueda de personas no tolera tildes faltantes** ("maria" no encuentra "María"). Se combina `ILIKE` + `similarity` con umbral 0.15. La solución sería la extensión `unaccent`.
- **Rutas literales antes que paramétricas** (`/lista-espera`, `/vencidos`, `/mi-password` antes de `/:id`).
- **`aprobar`, `rechazar` y `anular` son `POST`, no `PATCH`.** Con el método equivocado Express responde 404 antes de evaluar el rol — un test mal escrito pasaría sin probar nada.

**Antes de codear**

- Releer la sección 5 antes de tocar mutaciones de entregas, solicitudes, inventario o préstamos.
- **Escritura auditable o SP → `withUserTransaction`**, nunca Prisma.
- **Ruta nueva:** declarar `requireRole(...)` con un conjunto de `src/config/roles.ts`, o el servidor no arranca.
- **Catálogo nuevo:** revisar si encaja en `catalogo-simple.config.ts`.
- **Archivo nuevo:** usar `guardarArchivo()`.
- **Constraint o trigger nuevo con mensaje de usuario:** agregar entrada en `src/lib/errores/postgres.ts`.
- **Listado nuevo:** usar `src/lib/paginacion.ts`.
- **Correr `corepack pnpm test` antes de cada PR.**

---

## 15. Archivos y recursos

| Archivo | Estado |
|---|---|
| `Documentacion_Usumatlan_v2.pdf` | Documento original (119 páginas). **No refleja v2 ni v3**; los requisitos siguen vigentes |
| `scripts_bd_arreglada.sql` | Script v1. **Reemplazado.** Solo referencia histórica |
| `scripts_bd_arreglada_v2.sql` | ⚠️ **Contiene el esquema v3.** Fuente de verdad. Renombrar a `_v3` y versionar. Ver 4.1 |
| `06_sesiones.sql` | Ya integrada en el script vigente; útil al reconstruir |
| `07_genero_corto.sql` | **OBSOLETA.** No aplicar nunca |
| `08_fix_fn_auditoria_clave_compuesta.sql` | Ya **incluida** en el script vigente |
| `docs/API.md` | Referencia de endpoints, roles, errores y paginación |
| `db/migraciones/README.md` | Explica cada migración y su orden |

### Migraciones

| Script | Qué hace | Estado |
|---|---|---|
| `09_zona_horaria.sql` | `America/Guatemala` en la base | **Aplicada** |
| `10_auditoria_sesion_sin_latido.sql` | Quita el ruido del refresco de `ultima_actividad` | **Aplicada** |
| `11_indices_auditoria.sql` | Índices para los filtros de `GET /api/auditoria` | **Aplicada** |
| `12_rol_aplicacion_minimo_privilegio.sql` | Rol `dmm_app`, auditoría inalterable | **Aplicada** |
| `13_fix_recalculo_al_anular_entrega.sql` | Corrige la regresión de estado al anular | **Aplicada** |

### Reconstruir el entorno desde cero

1. Crear la base **como el usuario dueño** (`postgres`), nunca como `dmm_app`.
2. Ejecutar el script del esquema — con `psql -f` o tras eliminar el bloque duplicado (4.1).
3. Aplicar 09 a 13.
4. Crear el primer Administrador por SQL.
5. `pnpm prisma:pull && pnpm prisma:generate` (con el usuario dueño).
6. Verificar:
   ```sql
   SELECT current_setting('TimeZone'), CURRENT_DATE;                    -- America/Guatemala
   SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner='dmm_app';  -- 0
   SELECT has_schema_privilege('dmm_app','public','CREATE');            -- false
   ```
7. Repetir para `dmm_test` y correr `corepack pnpm test`.

---

Para el contrato exacto de endpoints, ir a `docs/API.md`. Para el comportamiento exacto de las reglas de negocio, las pruebas de `tests/negocio/` son la especificación ejecutable más fiel que existe del sistema.
