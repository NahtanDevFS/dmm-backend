# Sistema DMM Usumatlán — Documento Maestro del Proyecto

> **Propósito:** contexto completo y autocontenido para orientar el desarrollo del backend, útil para retomar el trabajo en cualquier momento o desde otra conversación/IA.
>
> **Revisión:** actualizado al **esquema v4** (migraciones hasta la 29), a las correcciones del **informe de QA** (hallazgos QA-01 a QA-17, sección 16) y a la suite de **402 pruebas** en 19 archivos.

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
| Base de datos | **PostgreSQL 17** (`scripts_bd_v4.sql`, con las migraciones hasta la 29). Prisma en modo **`db pull`** (introspección) |
| Testing | **vitest** — 402 pruebas en el backend (casi todas de integración contra base real, sin paralelismo) y 223 en el frontend |
| Gestor de paquetes | pnpm 11 |
| Módulos JS | **ESM real** (`"type": "module"` + `tsconfig` en `NodeNext`). Imports relativos requieren extensión `.js` |

**Prisma:** flujo `prisma db pull` → `prisma generate`. Cambios de estructura siempre en SQL plano primero. **Nunca `prisma migrate`/`db push`** sobre esta base.

**Variables de entorno en ESM:** en `NodeNext` los `import` estáticos se resuelven antes de ejecutar el punto de entrada, así que `dotenv.config()` dentro de `server.ts` corre demasiado tarde. Se precarga con `--import dotenv/config` en los scripts `dev`/`start` y en `setupFiles` de vitest, nunca dentro del código.

---

## 2. Roles del sistema

| Rol | Permisos |
|---|---|
| `EMPLEADO_DMM` | Operación diaria: beneficiarios, solicitudes, inventario, entregas, préstamos |
| `DIRECTORA` | Lo anterior más catálogos, aprobación/rechazo de solicitudes, multas, anulaciones, gestión de usuarios y consulta de auditoría |
| `ALCALDE` | **Solo reportes**, y los catálogos que alimentan sus filtros |
| `ADMINISTRADOR` | Todo. Es el único que ve y gestiona las cuentas `ADMINISTRADOR` |

### Las cuentas `ADMINISTRADOR` son invisibles para la Directora

Decisión funcional tomada al atender el hallazgo QA-03. La Directora gestiona usuarios, pero para ella las cuentas de administración **no existen**: no aparecen en `GET /api/usuarios`, el rol no aparece en `GET /api/roles`, y su ficha o cualquier operación sobre ellas (editar, desactivar, reactivar, restablecer contraseña) responde **404**, igual que un id inexistente, para no confirmar que ese id es un administrador. Asignar el rol `ADMINISTRADOR` al crear o editar responde **403**.

Dos excepciones aceptadas: en la **auditoría** la Directora sí ve a los administradores como autores de cambios (se decidió conservar la supervisión), y un nombre de usuario repetido responde "ya existe" aunque sea de un administrador, porque los nombres son únicos en todo el sistema.

**Nunca queda el sistema sin administradores:** cambiar el rol o desactivar al último `ADMINISTRADOR` activo responde 409. La regla mira el rol del usuario **afectado** (antes miraba el de quien hacía el cambio y no protegía nada) y se comprueba dentro de la transacción con `FOR UPDATE`, así que dos cambios simultáneos tampoco lo logran.

El catálogo `rol` tiene un `CHECK` (`rol_nombre_valido_check`) que solo permite estos 4 valores, sembrados de forma idempotente.

### El alcance de `ALCALDE` — resuelto

Durante una auditoría se detectó que cerca de **veinte endpoints de lectura de negocio** llevaban solo `requireAuth`, sin `requireRole`. Un `ALCALDE` autenticado accedía a solicitudes, entregas, contratos, inventario y —lo más delicado— a `GET /api/personas/:id/documentos`, es decir a los **DPI escaneados de beneficiarios** y a las evidencias fotográficas de entrega. La regla confirmada con el cliente decía que solo entra a reportes.

**Cerrado.** Todos esos endpoints usan hoy el conjunto `OPERACION`, que excluye a `ALCALDE`. La decisión y su verificación están en las secciones 9 y 11.

**Excepción deliberada:** `ALCALDE` **sí** lee `comunidades`, `departamentos`, `municipios`, `discapacidades`, `programas` y `categorias-insumo`. No es un olvido: son exactamente los seis catálogos que alimentan los filtros de sus reportes (`comunidadId`, `discapacidadId`, `programaId`, `categoriaId`). Sin ellos su único módulo queda inutilizable porque no puede poblar ni un `<select>`. Está verificado contra `reporte.schema.ts` y cubierto por pruebas.

### `rol` NO es un catálogo administrable

El documento de requisitos original (RF-CAT-01/06) trataba `rol` como catálogo con CRUD. **Se descartó**: cada rol tiene sus permisos codificados en el backend (`requireRole(...)`), así que un rol nuevo creado desde una pantalla no tendría ningún permiso real.

- No existe ni se construirá un CRUD de `rol`.
- `GET /api/roles` existe solo como lista para el `<select>` de gestión de usuarios, y por eso es de `ADMINISTRACION` (Directora y Administrador). A la Directora no le devuelve `ADMINISTRADOR`.
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

Referencia vigente: **`db/migraciones/scripts_bd_v4.sql`** — 56 tablas, 26 funciones, 9 procedimientos, 13 vistas, 126 triggers, 37 constraints `CHECK`, ~9,980 líneas. Incluye las migraciones hasta la 29.

### 4.1 El esquema del repositorio vuelve a reproducir la base real (QA-15)

**Resuelto.** Después de la migración 13 se aplicaron **a mano las 14 a la 27**, que nunca llegaron al repositorio. Una base creada con el v3 no podía registrar una entrega, y además sembraba el tipo de multa `RETRASO_DEVOLUCION` cuando el código busca `ATRASO`, así que la multa automática por atraso nunca se aplicaba en un entorno nuevo.

`scripts_bd_v4.sql` se generó a partir de la base vigente (`dmm_test`, idéntica en esquema y permisos a la de desarrollo) y se verificó así: se montó una base limpia **solo con el v4**, su esquema resultó idéntico al vigente, permisos incluidos, y la suite completa del backend pasó contra ella conectada como `dmm_app`.

- **No trae usuarios ni datos de personas.** El v3 traía el hash de la contraseña de una cuenta real; el v4 explica en su encabezado cómo crear el primer administrador con `crypt()` de `pgcrypto`, que genera hashes bcrypt compatibles con el backend.
- **Usa `current_database()`** para el `GRANT CONNECT` y la zona horaria; el v3 tenía el nombre de la base escrito a mano.
- **`scripts_bd_v3.sql` queda solo como histórico.** No usarlo para montar entornos.

Si alguien conserva los archivos originales de las migraciones 14 a 27, conviene agregarlos a `db/migraciones/`: el v4 reproduce el resultado, pero no documenta el porqué de cada cambio.

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

**v3 → v4 (migraciones 14 a 29).** Las 14 a 27 se aplicaron sin versionar; lo que se sabe por el esquema y por los comentarios del código: entrega por lotes (`detalle_entrega_lote`, `fn_crear_entrega`, `sp_agregar_insumo_entrega`, desde la 19), formularios configurables por categoría de insumo (`formulario`, `formulario_campo`, `catalogo`, respuestas por línea de solicitud, desde la 15), modalidad donación/préstamo de las solicitudes, catálogos del estudio socioeconómico (`estado_civil`, `ocupacion`, `grado_academico`), evidencias de contrato, encargado de menores ya no obligatorio (22), cierre de préstamos como `NO_DEVUELTO` con `motivo_cierre` (26), serie por unidad (27), y permisos más finos para `dmm_app`: catálogos de sistema y vistas en solo lectura. Versionadas en el repositorio:

- **28 — formato del CUI/DPI:** `CHECK (cui_dpi ~ '^[0-9]{13}$')`; `NULL` sigue permitido. La API ya exigía la misma regla (QA-12).
- **29 — tipos de documento legibles:** "Partida de nacimiento", "Otro", y el DPI del encargado dividido en anverso y reverso como el del beneficiario.

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
| `modalidad_solicitud` | `DONACION`, `PRESTAMO` |
| `estado_contrato_prestamo` | `VIGENTE`, `DEVUELTO`, `VENCIDO`, `EXTENDIDO`, `NO_DEVUELTO` |
| `tipo_genero` | `MASCULINO`, `FEMENINO`, `OTRO`, `PREFIERE_NO_DECIR` |
| `tipo_parentesco` | `MADRE`, `PADRE`, `HIJO_A`, `HERMANO_A`, `ABUELO_A`, `TIO_A`, `CONYUGE`, `OTRO` |
| `tipo_documento_persona` | "Partida de nacimiento", "DPI anverso", "DPI reverso", "DPI del encargado anverso", "DPI del encargado reverso", "Otro" (se muestran tal cual en pantalla) |
| `tipo_evidencia_entrega` | `FOTO_BENEFICIARIO_CON_INSUMO`, `FOTO_RECEPTOR`, `FOTOCOPIA_DPI_RECEPTOR`, `OTRO`, `RECETA_MEDICA`, `FORMULARIO_FIRMADO` |
| `tipo_evidencia_contrato` | `CONTRATO_FIRMADO`, `DPI_FRONTAL`, `DPI_REVERSO`, `FOTO_RECEPCION`, `OTRO` |
| `tipo_multa_prestamo` | `ATRASO` (Q50), `EQUIPO_DANADO`. **`ATRASO` es el nombre que busca `marcarContratosVencidos`** para la multa automática |
| `tipo_dato_campo_formulario` | `TEXTO_CORTO`, `TEXTO_LARGO`, `NUMERO`, `FECHA`, `SI_NO`, `SELECCION_UNICA`, `SELECCION_MULTIPLE`, `FECHA_NACIMIENTO` |

El v4 siembra además datos de referencia públicos: los 22 departamentos y 340 municipios de Guatemala, estado civil, ocupación, grado académico y discapacidades.

**El orden de siembra importa:** `tipo_accion_auditoria` va **primero**. Cada tabla auditada tiene un trigger `AFTER INSERT` que resuelve `tipo_accion_id` buscando `TG_OP` en ese catálogo; si está vacío, el `SELECT` da `NULL` y **ninguna escritura del sistema funciona**. Está replicado en `tests/helpers/bd.ts`.

---

## 5. Reglas de negocio en la base de datos

**El backend NO reimplementa esta lógica; la orquesta e interpreta.**

**Triggers de validación:** `fn_validar_menor_encargado` (`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` sobre `persona` y `encargado_menor`), `fn_validar_stock_linea_solicitud`, `fn_calcular_recepcion_lote`, `fn_calcular_cantidad_entregada` + `fn_descontar_inventario` (con `FOR UPDATE`), `fn_restaurar_inventario`.

**Triggers de cálculo:** `fn_estado_inicial_linea_solicitud`, `fn_actualizar_linea_desde_entrega`, `fn_recalcular_linea_solicitud`, `fn_recalcular_cabecera_solicitud`, `fn_set_updated_at`, `fn_auditoria`.

**Auditoría — CRÍTICO:** el backend inyecta `SET LOCAL app.usuario_id` (vía `withUserTransaction`) en cada transacción de escritura. Verificado end-to-end.

**Los 9 stored procedures y la función de alta de entrega:**

| Procedimiento | Firma | Invocado desde |
|---|---|---|
| `fn_crear_entrega` (función) | `(persona, usuario, observaciones, receptor, parentesco)` → id | `entrega.repository.ts`, `contrato.repository.ts` — crea la cabecera |
| `sp_agregar_insumo_entrega` | `(entrega, insumo, cantidad, detalle_solicitud, lote_elegido)` | `entrega.repository.ts`, `contrato.repository.ts` — un renglón, repartido por lote en `detalle_entrega_lote` |
| `sp_registrar_entrega` | 8 params | **Solo las pruebas.** Es el flujo anterior a la entrega por lotes; el backend ya no lo llama |
| `sp_desactivar_entrega` | `(entrega_id, usuario_id, motivo)` | `entrega.repository.ts` |
| `sp_desactivar_detalle_entrega` | `(detalle_entrega_id, usuario_id, motivo)` | `entrega.repository.ts`, `contrato.repository.ts` — anula un solo renglón |
| `sp_procesar_donacion_pendientes` | `(insumo_id, recepcion_lote_id)` | `recepcion.repository.ts` |
| `sp_dar_baja_insumo_vencido` | 3 | `recepcion.repository.ts` |
| `sp_cancelar_linea_solicitud` | 3 | `solicitud.repository.ts` |
| `sp_cancelar_solicitud_completa` | 3 | `solicitud.repository.ts` |
| `sp_registrar_devolucion_prestamo` | `(contrato_id, usuario_id)` | `contrato.repository.ts` |

**`sp_procesar_donacion_pendientes` NO es automático** — el backend lo invoca explícitamente tras cada `INSERT` en `detalle_inventario_lote`, en la misma transacción. Y **no descuenta inventario**: solo marca líneas como listas para entrega. El descuento físico ocurre al despachar; si descontara aquí, el stock se restaría dos veces.

**Funciones auxiliares:** `fn_calcular_edad`, `fn_edad_en_fecha`, `fn_es_menor`, `fn_es_adulto_mayor` (65), `fn_stock_disponible`, `fn_semaforo_caducidad`. (`fn_convertir_a_base`, obsoleta desde el v3, ya no existe en la base vigente.)

**Vistas:** `v_inventario_lote_fifo`, `v_stock_insumo`, `v_stock_insumo_presentaciones`, `v_semaforo_inventario`, `v_lista_espera`, `v_persona_edad` (**sin consumidor**), `v_reporte_personas_atendidas`, `v_solicitudes_activas`, `v_reporte_stock_por_categoria`, `v_reporte_poblacion_beneficiada`.

### 5.1 Reglas del backend que conviene tener presentes

- **Solicitudes:** los estados de las líneas los asigna la base según stock real. **Aprobar no cambia `estado_id`**: `aprobada` es columna aparte. Si un insumo con `bloquea_solicitud_sin_stock` no tiene existencias → 409 **sin cabecera huérfana**.
- **Entregas:** la base elige lotes por **FEFO con respaldo FIFO** (caducidad más próxima; los sin caducidad al final, mediante `+100 years` en `v_inventario_lote_fifo`). Anular devuelve **a cada lote de origen**, no a un total agregado. Si el lote fue dado de baja, **no** se restaura y se emite un `WARNING`: devolver unidades a un lote vencido inflaría el inventario con producto inservible.
- **Préstamos:** un contrato nace de un renglón de entrega o es renovación de otro, **nunca ambas** (`contrato_origen_check`). La cadena es **lineal**: un contrato admite **una sola** renovación (`contrato_prestamo_anterior_unico_key`). Solo el contrato raíz tiene `detalle_entrega_id`, así que `sp_registrar_devolucion_prestamo` **solo opera sobre él** y el backend resuelve la raíz con un CTE recursivo antes de invocarlo.
- **`vencidos` se calcula por fechas, no por `estado_id`**: nada en la base mueve ese estado solo. `POST /api/contratos/marcar-vencidos` lo sincroniza (pensado para un cron) y aplica la multa automática `ATRASO` una sola vez por contrato. **`EXTENDIDO` y `NO_DEVUELTO` no son atrasos**: ni aparecen en `GET /api/contratos/vencidos` ni se multan (antes la lista seguía mostrando los préstamos cerrados como no devueltos, QA-17).
- **Multas:** sin `monto` se toma el `monto_sugerido` del tipo. "Anular" es `activo = false`.
- **Recepción:** el backend **no envía** `cantidad_inicial` ni `cantidad_disponible`; un trigger las calcula como `FLOOR(cantidad × unidades_por_presentacion_lote)`. Trunca, no redondea.

---

## 6. Casos de uso documentados

Formato tabla RUP: **Iniciar sesión** (con flujos alternativos A1 credenciales incorrectas / A2 usuario inactivo), **Ver/Editar/Desactivar beneficiarios**. Guía de UX y de redacción de errores (RNF-USA-02).

---

## 7. Arquitectura de acceso a datos

### 7.1 Prisma vs. `pg` directo

**Prisma** — CRUD simple y lecturas sin auditoría. **`pg.Pool` directo** — cualquier SP, o INSERT/UPDATE auditable.

**Patrón obligatorio** (`src/db/withUserTransaction.ts`): `BEGIN` → `set_config('app.usuario_id', ..., true)` → trabajo → `COMMIT`/`ROLLBACK` → `client.release()` en `finally`. Si el `ROLLBACK` falla (conexión caída), se propaga el **error original** y el cliente se descarta en vez de volver al pool (QA-08).

**Conexiones caídas:** `pool.ts` le pone un manejador de `error` a cada conexión nueva. Sin él, si PostgreSQL cortaba una conexión mientras estaba prestada (un reinicio a mitad de una transacción), `pg` emitía un evento sin escucha y **Node terminaba el proceso completo**.

**Regla dura:** ninguna escritura auditable pasa por `prisma.<modelo>.create/update/delete`. **Verificado: cero ocurrencias en todo `src/`.**

### 7.2 Estructura de carpetas

```
src/
  config/roles.ts       → matriz de autorización (sección 9)
  config/seguridad.ts   → coste de bcrypt, compartido por el alta y el login
  db/                   prisma.ts / pool.ts / withUserTransaction.ts
  lib/
    errores/postgres.ts    → interceptor de errores de BD (7.5)
    fechas.ts              → fechas AAAA-MM-DD reales y rangos (QA-11)
    busqueda.ts            → escapa % y _ para búsquedas literales (QA-13)
    paginacion.ts          → sobre uniforme de listados (7.7)
    reportes/exportar.ts   → xlsx y pdf
    rutas-protegidas.ts    → guarda de arranque (sección 9)
    storage/               → file-validation, storage.service, upload.middleware, archivos.routes, ruta-segura
  middlewares/          auth / role / error / rate-limit
  modules/              auth, catalogos, catalogos-lectura, geografia, comunidades,
                        personas, insumos, inventario, solicitudes, entregas,
                        prestamos, reportes, auditoria, usuarios
  routes/routes.ts
  app.ts / server.ts
db/migraciones/         → scripts_bd_v4.sql (entornos nuevos), 09 a 13, 28, 29 + README
docs/API.md             → referencia de endpoints
tests/                  → 19 archivos, 402 pruebas (sección 11)
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

`src/lib/errores/postgres.ts`. Mapea **24 constraints por nombre** y traduce por código: `23503`→400, `23502`→400, `23514`/`23505`/`23P01`→400/409, `22007`/`22008` (fecha inexistente)→400. `P0001` (excepciones de triggers, ya en español) se devuelven tal cual con 400 o 409 según el caso. `humanizarMensajeTrigger` sustituye ids por nombres.

Antes de llegar ahí, `error.middleware.ts` traduce dos familias que caían en el 500 genérico o exponían mensajes técnicos en inglés (QA-04 y QA-10):

- **Subidas (`MulterError`):** archivo de más de 8 MB → **413**; campo de archivo inesperado u otra carga inválida → 400.
- **Cuerpo de la petición (body-parser):** JSON mal formado → 400; más de 1 MB → **413**; codificación o juego de caracteres no soportado → 415.

**Fechas (QA-11):** todos los esquemas usan `fechaSchema()` de `src/lib/fechas.ts`, que exige `AAAA-MM-DD` con un día que exista. `Date.parse` aceptaba "2025-02-31" (lo corría al 3 de marzo), "2024-9-01" y hasta "hola 1", y PostgreSQL respondía con un 500. Los listados y reportes con `desde`/`hasta` rechazan además el rango invertido.

### 7.6 Manejo de archivos

Almacenamiento local en disco, con `multer` + `sharp` + `file-type`. Utilidad compartida en `src/lib/storage/`, usada desde cada módulo (no un endpoint genérico de subida, que produciría archivos huérfanos).

**Capas de seguridad:**
1. Límite de 8 MB.
2. **Validación por firma binaria real** (magic bytes), no por extensión ni `Content-Type` — ambos los controla quien sube. Lista blanca: JPEG, PNG, WEBP, PDF.
3. Toda imagen se **recomprime siempre** (máx. 1600 px, JPEG 80): descarta payloads incrustados en metadatos.
4. Nombres en disco **siempre UUID generado por el servidor**.
5. Se sirven vía `GET /api/archivos/*rutaArchivo`, con `requireAuth` + `requireRole(OPERACION)`. La ruta pedida se valida **por segmentos** con `path.relative` (`lib/storage/ruta-segura.ts`): el `startsWith` anterior aceptaba carpetas hermanas como `uploads-old` (QA-07). La prueba llama a esa misma función, no a una copia.

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
- `PATCH /api/usuarios/mi-password` — exige la contraseña actual. Si no coincide responde **400** con `code: "CURRENT_PASSWORD_INVALID"`, **no 401**: el frontend trata todo 401 como sesión expirada y sacaba al usuario por un error de tecleo (QA-02). Tiene su propio límite: **5 intentos fallidos cada 15 minutos por usuario**; cada respuesta trae `intentos_restantes` y el modal lo muestra bajo el campo, y al agotarlos responde 429 (QA-06).

**Asimetría deliberada en el login:** contraseña incorrecta y usuario inexistente devuelven **401 idéntico** (evita enumeración de cuentas), pero un usuario **desactivado** recibe **403** con mensaje propio. Quien llega ahí ya demostró conocer la contraseña, así que no se revela nada nuevo; a cambio el empleado sabe que debe hablar con el administrador en vez de reintentar.

**Mismo tiempo de respuesta (QA-05):** con un usuario inexistente el login también pasa por `bcrypt.compare`, contra un hash ficticio calculado una vez al arrancar con el mismo coste que los reales. Antes respondía sin comparar y el tiempo delataba qué cuentas existen.

**Contraseñas y bcrypt (QA-14):** bcrypt solo usa los primeros **72 bytes**. El límite se cuenta en bytes UTF-8, no en caracteres: con tildes, ñ o emojis una contraseña de menos de 72 caracteres podía pasarse y el resto se ignoraba en silencio.

**Cierre de sesión sin confirmar (QA-16):** si el logout no llega al servidor (sin red, caído, 500), el frontend oculta los datos pero **no finge que cerró**: muestra "No se pudo confirmar el cierre de sesión" con un botón para reintentar. La marca queda en `localStorage`, así que al recargar se reintenta el cierre en vez de recuperar la sesión con `/auth/me`, y también se reintenta sola al volver la conexión. Un 401 del logout cuenta como cierre confirmado.

**No hay registro público.** El primer Administrador se crea por SQL, con `crypt()` de `pgcrypto` (ver el encabezado de `scripts_bd_v4.sql`).

### 8.4 Rol de base de datos de mínimo privilegio (migración 12)

El backend conectaba como superusuario. Quien obtuviera el `DATABASE_URL` podía borrar filas, tirar tablas, **desactivar los triggers de auditoría** y escribir directamente en `auditoria_log`. Nada de eso es necesario para operar.

`dmm_app` no tiene: `DELETE` en ninguna tabla (el sistema usa borrado lógico en todas partes — verificado: **no existe un solo `DELETE` físico** en la base ni en el backend), DDL, ni escritura sobre `auditoria_log`. Desde las migraciones sin versionar, los catálogos de sistema (`tipo_accion_auditoria`, `modalidad_solicitud`, `estado_civil`) y todas las vistas son además de **solo lectura** para él. El v4 reproduce estos permisos exactos.

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
| `ADMINISTRACION` | Directora, Admin | Usuarios, auditoría, `GET /api/roles`. Las cuentas `ADMINISTRADOR` solo las ve otro administrador (sección 2) |

### 9.2 Guarda de arranque (`src/lib/rutas-protegidas.ts`)

Recorre el router al importar `app.ts` y **falla el arranque** si alguna ruta no declara roles. Olvidar un `requireRole` deja de ser un agujero silencioso en producción y pasa a ser un error visible en `pnpm dev`.

**También falla si no puede ejecutarse (QA-09).** Recorrer las rutas depende de `router.stack`, una estructura interna de Express que puede cambiar en una actualización. Antes, si no la encontraba, escribía un aviso en consola y el servidor arrancaba **sin haber revisado nada**. Ahora el arranque se detiene si no encuentra la lista de rutas, si el recorrido lanza un error o si no reconoce ninguna ruta. El mensaje indica qué adaptar.

Cada ruta lleva `requireRole(...)` o `permitirSinRol("motivo")`. **No hay lista de excepciones**: la exención se declara en la propia ruta, donde la ve quien revisa el cambio. Las cuatro actuales: `POST /login`, `POST /logout`, `GET /me`, `PATCH /usuarios/mi-password`.

Estado verificado: **197 rutas — 193 con rol declarado, 4 exentas con motivo, 0 desprotegidas.**

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
| Gestión de usuarios y `/api/roles` | — | ✅ (sin ver administradores) | — | ✅ |
| Auditoría | — | ✅ | — | ✅ |

---

## 10. Seguridad — checklist

- [x] Bcrypt (coste 12). Mínimo 8 caracteres con letra y número; máximo 72 **bytes** UTF-8.
- [x] Login con tiempo de respuesta uniforme, exista o no el usuario.
- [ ] HTTPS obligatorio — pendiente despliegue.
- [x] Expiración de sesión por inactividad, validada en servidor.
- [x] Queries parametrizadas.
- [x] Validación Zod en cada endpoint.
- [x] Ninguna escritura auditable pasa por Prisma.
- [x] Rate limiting — login: 10 intentos fallidos por IP+usuario cada 15 min (`skipSuccessfulRequests`, con `ipKeyGenerator` para que IPv6 no lo evada; combinar IP y usuario evita que una salida NAT bloquee a toda la municipalidad). Cambio de la propia contraseña: 5 intentos fallidos por usuario cada 15 min, con los restantes visibles. General: 300/min.
- [x] `helmet` (con `crossOriginResourcePolicy: cross-origin`; CSP desactivada por ser API sin HTML).
- [x] `trust proxy = 1`.
- [x] Límite de cuerpo de 1 MB.
- [x] CORS restrictivo (`credentials: true` + origen explícito, nunca `*`).
- [x] Archivos validados por firma binaria y recomprimidos; descargas contenidas en `uploads` por segmentos de ruta.
- [x] Interceptor de errores de Postgres, de subidas y del parser de JSON: ningún error de entrada termina en 500.
- [x] Redacción de credenciales en auditoría (`password_hash`, `token_hash` → `[redactado]`).
- [x] Guardas de gestión de usuarios: no cambiarse el propio rol, no autodesactivarse, nunca quedarse sin un `ADMINISTRADOR` activo (también con cambios simultáneos). Administradores invisibles para la Directora.
- [x] Búsquedas `ILIKE` literales: `%` y `_` se escapan.
- [x] Cierre de sesión que no se da por hecho si el servidor no lo confirma.
- [x] Una conexión caída a mitad de transacción ya no tumba el servidor.
- [x] Esquema del repositorio reproducible y sin credenciales (`scripts_bd_v4.sql`).
- [x] **Alcance de `ALCALDE` cerrado** y verificado con pruebas.
- [x] **Rol de BD de mínimo privilegio** (migración 12).
- [x] **Auditoría inalterable** desde la aplicación (`SECURITY DEFINER`).
- [x] **Guarda de arranque** contra rutas sin declarar roles, que tampoco deja arrancar si no pudo verificarlas.
- [ ] Logs de aplicación separados de `auditoria_log` — no formalizado (hoy `console.error`).
- [ ] Backups automáticos — pendiente infraestructura.

---

## 11. Testing

**402 pruebas en 19 archivos.** Runner: **vitest** sin paralelismo (`fileParallelism: false`), con `dotenv/config` + `tests/setup.ts` en `setupFiles`. El frontend tiene su propia suite (223 pruebas con Vitest y Testing Library).

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
| `matriz-declarada` | 6 | Ninguna ruta sin roles; exentas acotadas; **el arranque falla si el verificador no puede ejecutarse** (sin BD) |
| `fechas` | 6 | Fechas `AAAA-MM-DD` reales, bisiestos, rango invertido (sin BD) |
| `validaciones` | 6 | CUI/DPI de 13 dígitos o `null`; límite de 72 bytes de bcrypt (sin BD) |
| `negocio/inventario` | 13 | Cálculo de lote, validaciones condicionales, descuento, **concurrencia sobre el mismo lote** |
| `negocio/entregas` | 15 | FEFO/FIFO, encadenado entre lotes, validaciones, **anulación que devuelve a cada lote de origen** |
| `negocio/solicitudes` | 10 | Estado inicial por stock, bloqueo de insumos críticos |
| `negocio/lista-espera` | 17 | Reparto por antigüedad, recálculo de línea y cabecera, **regresión al anular** |
| `negocio/prestamos` | 18 | `contrato_origen_check`, renovación única, devolución sobre la raíz, multas |
| `negocio/prestamos-cierre` | 17 | Anulación y cierre `NO_DEVUELTO`; **fuera de vencidos**; **multa automática `ATRASO`** sin duplicados |
| `negocio/beneficiarios` | 14 | RF-BEN-03 con validación **diferida al COMMIT**, límite de los 18 años |
| `negocio/permisos-bd` | 14 | Propiedad, `DELETE`, `CREATE`, auditoría inalterable, `SECURITY DEFINER` |
| `negocio/ultimo-administrador` | 6 | Nunca sin administrador activo, por rol o desactivación, **incluso con cambios simultáneos** |
| `negocio/administradores-ocultos` | 7 | La Directora no ve, no abre (404) ni modifica administradores, ni asigna el rol (403) |
| `negocio/busqueda-literal` | 4 | `%` y `_` se buscan literalmente |
| `seguridad/archivos` | 17 | Firma binaria, normalización, nombres UUID, path traversal, **carpetas hermanas** |
| `seguridad/sesiones` | 17 | Inactividad, tope absoluto, revocación, credenciales |
| `seguridad/limite-cambio-password` | 4 | Cuenta regresiva, bloqueo 429, por usuario, un error de formato no gasta intentos |
| `with-user-transaction` | 6 | `app.usuario_id` llega a la base, rollback, retorno al pool, **ROLLBACK fallido con conexión cortada** |

**Las semillas de `tests/helpers/bd.ts` deben coincidir con las del v4.** No coincidían: sembraban `RETRASO_DEVOLUCION`, así que ninguna prueba cubría la multa automática con el nombre que usa el código.

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
| **10 — Permisos y pruebas** | ✅ Matriz centralizada, guarda de arranque, rol de BD |
| **11 — Correcciones del informe de QA** | ✅ QA-01 a QA-17 corregidos y probados (sección 16), esquema v4, 402 pruebas |

### Trabajo pendiente

1. **Ejecución formal de QA:** el informe pide ejecutar los casos CP-01 a CP-17 en el ambiente de QA y registrar evidencia (formatos F01/F02) antes de cerrar cada hallazgo.
2. **Recuperar los archivos originales de las migraciones 14 a 27**, si alguien los conserva (4.1).
3. **Cambiar la contraseña de la cuenta cuyo hash quedó en `scripts_bd_v3.sql`** y en el historial de git, si sigue siendo la misma.
4. **Revisar datos afectados por el bug de anulación** en la base real (consulta al final de la migración 13).
5. Ampliar pruebas de reportes.
6. Despliegue: HTTPS, backups, logs de aplicación.

---

## 13. Flujo de trabajo con Git y GitHub

Ramas: `main` (estable), `develop` (integración), `feature/*`, `fix/*`, `chore/*`. Conventional Commits. PR con base `develop`, ≥1 aprobación, **Squash and merge**.

**Ramas mergeadas:** `chore/setup-esm-zod-env`, `feature/auth-login-sesiones`, `feature/catalogos-crud`, `feature/geografia-comunidades`, `feature/categoria-insumo`, `feature/beneficiarios`, `feature/esquema-v2-catalogos-persona`, `feature/uploads-documento-persona`, `feature/insumos-presentaciones`, `feature/recepcion-donaciones`, `feature/solicitudes-apoyo`, `feature/entregas`, `feature/prestamos-multas`, `feature/reportes`, `feature/gestion-usuarios`, `feature/auditoria-consulta`, `chore/hardening`, `feature/roles`, `feature/tests`.

---

## 14. Notas y advertencias para quien continúe

**Base de datos**

- **Entornos nuevos: solo `scripts_bd_v4.sql`.** El v3 ya no reproduce la base (4.1).
- **Toda migración se guarda en `db/migraciones/` antes de aplicarla en ningún lado, y se agrega al final del v4.** Así se perdieron la 14 a la 27. Proceso completo en `db/migraciones/README-MIGRACIONES.md`.
- **Crear el esquema siempre con el usuario dueño, nunca con `dmm_app`** (8.4). La propiedad se salta los `GRANT`.
- **El esquema fue reemplazado una vez (v1→v2) y luego extendido (v2→v3→v4).** Confirmar la forma de cualquier tabla contra el v4 o un `schema.prisma` recién introspeccionado.
- **Los `CHECK` no aparecen en `schema.prisma`.** Una migración que solo agrega un `CHECK` o cambia datos (como la 28 y la 29) no requiere `prisma:pull`.
- **No duplicar en TypeScript** la lógica de triggers/SPs.
- **`app.usuario_id` en cada transacción auditable**, siempre vía `withUserTransaction`.
- **`sp_procesar_donacion_pendientes` NO es automático**, y **no descuenta inventario**.
- **Tablas con clave primaria compuesta requieren entrada explícita en el `CASE` de `fn_auditoria()`.**
- **Sembrar `tipo_accion_auditoria` antes que cualquier otro catálogo** (4.5).
- **Zona horaria:** `America/Guatemala` en la base; el v4 la aplica a la base donde se ejecute. Sin ella, seis constraints que comparan contra `CURRENT_DATE` aceptan como válida una fecha de mañana después de las 18:00.
- **Los catálogos que el código busca por nombre no se renombran a la ligera:** `ATRASO`, `NO_DEVUELTO`, `EXTENDIDO`, `VENCIDO` y los estados de solicitud. Los tipos de documento sí son libres: se eligen de una lista y se muestran tal cual.

**Modelo (v4)**

- **Los tres flags viven en `insumo`, no en `categoria_insumo`.**
- **`presentacion_insumo` ya no tiene `factor_a_base`**; la conversión es por lote.
- **`marca_insumo` se vincula por lote**, no por insumo.
- **`persona.genero_id`** es FK a `tipo_genero` con valores largos. La migración `07_genero_corto.sql` está **obsoleta**, no aplicar nunca.
- **`rol` no es administrable.**
- **`v_persona_edad` no tiene consumidor** (y `dmm_app` no tiene permiso sobre ella).

**Trampas técnicas ya pagadas**

- **⚠️ Prisma introspecciona `insumo → presentacion_insumo` como relación 1:1**, no 1:N, por el índice único parcial `idx_presentacion_default_unica`. Hoy no explota porque ese repositorio usa `pg` directo, pero `prisma.insumo.findUnique({ include: { presentacion_insumo: true } })` devolvería **una sola presentación**. Leer desde `presentacion_insumo` hacia arriba.
- **Express 5 exige wildcards con nombre** y devuelve un array de segmentos (7.6).
- **Rutas desde variables de entorno: siempre `path.resolve()` antes de comparar prefijos.**
- **ESM: precargar `dotenv` con `--import`**, nunca `dotenv.config()` en el código.
- **`sesion_expira_en_valida_check` exige `expira_en > created_at`** (8.2).
- **`$n` de Postgres no se reutiliza entre columnas de distinto tipo**: un mismo parámetro para `numeric` e `integer` falla con `inconsistent types deduced for parameter`.
- **Búsqueda de personas no tolera tildes faltantes** ("maria" no encuentra "María"). Se combina `ILIKE` + `similarity` con umbral 0.15. La solución sería la extensión `unaccent`.
- **Todo `ILIKE` con texto del usuario pasa por `patronContiene()` o `escaparLike()`** (`src/lib/busqueda.ts`). Sin escapar, `_` coincide con cualquier carácter y buscar "_" devolvía todos los registros. `similarity` recibe el texto **sin** escapar.
- **Fechas de la API: siempre `fechaSchema()`** (`src/lib/fechas.ts`), nunca `Date.parse`.
- **jsdom no implementa `<dialog>.showModal()`**: las pruebas del frontend que montan un `Modal` lo reemplazan en el propio test.
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
| `Documentacion_Usumatlan_v2.pdf` | Documento original (119 páginas). **No refleja v2 en adelante**; los requisitos siguen vigentes |
| `scripts_bd_arreglada.sql` | Script v1. **Reemplazado.** Solo referencia histórica |
| `db/migraciones/scripts_bd_v3.sql` | Esquema v3. **Solo histórico**: no reproduce la base vigente y contiene el hash de una cuenta real |
| `db/migraciones/scripts_bd_v4.sql` | **Fuente de verdad del esquema.** Único script para entornos nuevos |
| `06_sesiones.sql` | Ya integrada en el script vigente |
| `07_genero_corto.sql` | **OBSOLETA.** No aplicar nunca |
| `08_fix_fn_auditoria_clave_compuesta.sql` | Ya **incluida** en el script vigente |
| `docs/API.md` | Referencia de endpoints, roles, errores y paginación |
| `db/migraciones/README-MIGRACIONES.md` | Explica cada migración, su orden y el proceso para agregar una |
| `Informe-QA-DMM.pdf` | Informe de evaluación estática (21/09/2026): 17 hallazgos y casos de prueba CP-01 a CP-17 (sección 16) |

### Migraciones

| Script | Qué hace | Estado |
|---|---|---|
| `09_zona_horaria.sql` | `America/Guatemala` en la base | **Aplicada** |
| `10_auditoria_sesion_sin_latido.sql` | Quita el ruido del refresco de `ultima_actividad` | **Aplicada** |
| `11_indices_auditoria.sql` | Índices para los filtros de `GET /api/auditoria` | **Aplicada** |
| `12_rol_aplicacion_minimo_privilegio.sql` | Rol `dmm_app`, auditoría inalterable | **Aplicada** |
| `13_fix_recalculo_al_anular_entrega.sql` | Corrige la regresión de estado al anular | **Aplicada** |
| 14 a 27 | Aplicadas a mano, **sin archivo en el repositorio** (4.2) | **Aplicadas** |
| `28_formato_cui_dpi.sql` | CUI/DPI de 13 dígitos o `NULL` | **Aplicada** |
| `29_tipos_documento_legibles.sql` | Nombres legibles; DPI del encargado en dos caras | Pendiente de aplicar en las bases existentes |

### Reconstruir el entorno desde cero

1. Crear la base **como el usuario dueño** (`postgres`), nunca como `dmm_app`.
2. Ejecutar `scripts_bd_v4.sql` (`psql -f` o pgAdmin). Ya incluye todas las migraciones; no hay que aplicar ninguna por separado.
3. Cambiar la clave de `dmm_app` si se acaba de crear, y crear el primer Administrador con `crypt()` (instrucciones en el encabezado del script).
4. Reconectar, por la zona horaria.
5. `pnpm prisma:generate`. `prisma:pull` solo si el esquema cambió después.
6. Verificar:
   ```sql
   SELECT current_setting('TimeZone'), CURRENT_DATE;                    -- America/Guatemala
   SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner='dmm_app';  -- 0
   SELECT has_schema_privilege('dmm_app','public','CREATE');            -- false
   ```
7. Repetir para `dmm_test` y correr `corepack pnpm test`.

---

## 16. Informe de QA (septiembre de 2026)

Evaluación estática del 21/09/2026 sobre frontend y backend: 17 hallazgos, cada uno con su caso de prueba (CP-01 a CP-17). Los 17 se confirmaron en el código y se corrigieron; cada corrección tiene pruebas automáticas y, donde se pudo, se probó además en el navegador contra la aplicación real.

| ID | Hallazgo | Corrección |
|---|---|---|
| QA-01 | Editar solo el nombre o el programa de un usuario daba 400 | Se aceptan los cuatro campos editables; `programa_id: null` quita el programa |
| QA-02 | Contraseña actual incorrecta sacaba al usuario de la aplicación | 400 con `CURRENT_PASSWORD_INVALID` en vez de 401 (8.3) |
| QA-03 | La guarda del último administrador miraba al que hacía el cambio | Mira al afectado, dentro de la transacción; administradores invisibles para la Directora (sección 2) |
| QA-04 | Archivo de más de 8 MB → 500 | 413 con mensaje claro (7.5) |
| QA-05 | El login delataba por tiempo qué usuarios existen | Hash ficticio con el mismo coste (8.3) |
| QA-06 | Sin límite propio al cambiar la contraseña | 5 intentos por usuario cada 15 min, restantes visibles (8.3) |
| QA-07 | La descarga aceptaba carpetas hermanas de `uploads` | Contención por segmentos (7.6) |
| QA-08 | Un ROLLBACK fallido ocultaba el error original | Se propaga el original y se descarta la conexión (7.1) |
| QA-09 | El verificador de rutas fallaba en silencio | El arranque se detiene (9.2) |
| QA-10 | Errores del parser con mensajes técnicos | 400/413/415 con mensajes estables (7.5) |
| QA-11 | Fechas inexistentes llegaban a PostgreSQL → 500 | `fechaSchema()` y rango invertido rechazado (7.5) |
| QA-12 | La API aceptaba cualquier CUI/DPI, incluido `""` | 13 dígitos o `null`, en la API y con `CHECK` (migración 28) |
| QA-13 | `%` y `_` actuaban como comodines en las búsquedas | Búsqueda literal (sección 14) |
| QA-14 | El límite de 72 de bcrypt se contaba en caracteres | Se cuenta en bytes UTF-8 (8.3) |
| QA-15 | El esquema del repositorio no reproducía la base | `scripts_bd_v4.sql`, verificado con la suite completa (4.1) |
| QA-16 | El logout fallido se daba por hecho | Pantalla de cierre pendiente y reintento (8.3) |
| QA-17 | Préstamos `NO_DEVUELTO` seguían en vencidos | Excluidos de la lista (5.1) |

**Lo que el informe no pedía y apareció al corregir:** una conexión caída a mitad de transacción tumbaba el servidor (7.1); la multa automática por atraso no se aplicaba en entornos nuevos (4.1); el v3 contenía el hash de una cuenta real.

**Para cerrar formalmente cada hallazgo** falta que QA ejecute sus casos en su ambiente y registre la evidencia (sección 12).

---

Para el contrato exacto de endpoints, ir a `docs/API.md`. Para el comportamiento exacto de las reglas de negocio, las pruebas de `tests/negocio/` son la especificación ejecutable más fiel que existe del sistema.
