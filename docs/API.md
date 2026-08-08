# API — Sistema DMM Usumatlán

Referencia de los endpoints del backend. Base: `/api`.

- **Autenticación**: cookie de sesión `dmm_session`, HttpOnly. No hay header
  `Authorization`. El cliente debe enviar las peticiones con las cookies
  habilitadas (`credentials: "include"` en `fetch`, `withCredentials: true` en
  Axios, cookie jar activo en Postman).
- **Sesión**: expira a los **30 min de inactividad** y a las **12 h** desde el
  login, lo que ocurra primero. Ambas se validan en el servidor.
- **Formato**: JSON en peticiones y respuestas, salvo las subidas de archivo
  (`multipart/form-data`) y las exportaciones de reportes.

## Roles

| Rol | Alcance |
|---|---|
| `EMPLEADO_DMM` | Operación diaria: beneficiarios, solicitudes, inventario, entregas, préstamos |
| `DIRECTORA` | Lo anterior más catálogos, aprobaciones, multas, anulaciones y reportes |
| `ALCALDE` | **Solo reportes**, solo lectura. No tiene acceso a ningún otro módulo |
| `ADMINISTRADOR` | Todo, más gestión de usuarios y consulta de auditoría |

`rol` no es administrable: los permisos están codificados en cada ruta
(`requireRole`), así que un rol nuevo creado desde una pantalla no tendría
ningún permiso real. `GET /api/roles` existe solo para poblar un `<select>`.

## Errores

Todas las respuestas de error traen `{ "message": "..." }`. Las de validación
agregan `errores` con el detalle por campo.

| Código | Significado |
|---|---|
| `400` | Datos inválidos, o una referencia que no existe / está inactiva |
| `401` | Sin sesión, sesión expirada o revocada, o contraseña incorrecta |
| `403` | Autenticado pero sin el rol necesario |
| `404` | El recurso no existe, o no pertenece al padre de la ruta |
| `409` | Conflicto con el estado actual: duplicado, sin stock, ya entregado, ya cancelado |
| `429` | Límite de peticiones excedido |
| `500` | Fallo no previsto. El detalle queda en el log del servidor, no en la respuesta |

Buena parte de las reglas de negocio viven en triggers y stored procedures de
PostgreSQL. Sus excepciones se traducen a mensajes en español; ver
`src/lib/errores/postgres.ts`.

## Límite de peticiones

| Ruta | Límite |
|---|---|
| `POST /api/auth/login` | 10 intentos fallidos por IP+usuario cada 15 min. Un login correcto no gasta cuota |
| Todo `/api` | 300 peticiones por minuto y por IP |

## Paginación

Los **listados de negocio** devuelven este sobre:

```json
{
  "total": 240,
  "limite": 50,
  "desplazamiento": 0,
  "hay_mas": true,
  "datos": [ ... ]
}
```

Parámetros: `?limite=` (1–200, por defecto 50) y `?desplazamiento=` (por defecto 0).

Paginan: `/personas`, `/insumos`, `/recepciones`, `/solicitudes`, `/entregas`,
`/contratos`, `/usuarios`, `/auditoria`.

**No paginan**, y devuelven el arreglo completo: los catálogos de selección
(discapacidades, programas, unidades de medida, marcas, categorías, `tipos-*`,
`estados-*`, departamentos, municipios, comunidades, roles) porque están acotados
y su consumidor es un `<select>`; los sub-recursos de una ficha (líneas,
presentaciones, documentos, evidencias, multas); y los reportes, que se consumen
enteros para exportarlos.

---

## Autenticación

| Método | Ruta | Acceso | Notas |
|---|---|---|---|
| POST | `/api/auth/login` | público | `{ username, password }`. Emite la cookie |
| POST | `/api/auth/logout` | autenticado | Revoca la sesión en la base. Idempotente |
| GET | `/api/auth/me` | autenticado | Devuelve `{ usuario: { id, username, rol } }`. **Necesario para recuperar la sesión al recargar la página**: la cookie es HttpOnly y el frontend no puede leerla |

## Catálogos

Seis catálogos comparten el mismo CRUD genérico. Sustituya `<recurso>` por:
`discapacidades`, `programas`, `categorias-insumo`, `marcas-insumo`,
`unidades-medida`, `instituciones-donantes`.

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/<recurso>` — `?incluirInactivos=true` | autenticado |
| GET | `/api/<recurso>/:id` | autenticado |
| POST | `/api/<recurso>` | DIRECTORA, ADMINISTRADOR |
| PATCH | `/api/<recurso>/:id` | DIRECTORA, ADMINISTRADOR |
| PATCH | `/api/<recurso>/:id/desactivar` | DIRECTORA, ADMINISTRADOR |
| PATCH | `/api/<recurso>/:id/reactivar` | DIRECTORA, ADMINISTRADOR |

Desactivar devuelve **409** si hay registros activos que dependen del catálogo,
con un mensaje que explica cuáles. `instituciones-donantes` acepta además
`telefono` y `correo`; solo `programas` tiene `descripcion`.

`comunidades` sigue el mismo contrato pero es un módulo aparte: exige
`municipio_id` y su unicidad es por `(nombre, municipio_id)`. Acepta
`?municipioId=`.

### Catálogos de solo lectura

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/departamentos` · `/api/municipios` — `?departamentoId=` | autenticado |
| GET | `/api/tipos-genero` · `/api/tipos-parentesco` · `/api/tipos-documento-persona` | autenticado |
| GET | `/api/tipos-evidencia-entrega` · `/api/tipos-multa-prestamo` | autenticado |
| GET | `/api/estados-solicitud` · `/api/estados-contrato-prestamo` | autenticado |
| GET | `/api/roles` | autenticado |

## Beneficiarios

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/personas` — `?busqueda=` `?comunidadId=` `?incluirInactivos=` | EMPLEADO_DMM+ |
| GET · POST | `/api/personas[/:id]` | EMPLEADO_DMM+ |
| PATCH | `/api/personas/:id` · `/desactivar` · `/reactivar` | EMPLEADO_DMM+ |
| POST · DELETE | `/api/personas/:id/discapacidades[/:discapacidadId]` | EMPLEADO_DMM+ |
| POST · DELETE | `/api/personas/:id/encargados[/:encargadoId]` | EMPLEADO_DMM+ |
| POST · PATCH · DELETE | `/api/personas/:id/contactos[/:contactoId]` | EMPLEADO_DMM+ |
| GET | `/api/personas/:id/documentos` | autenticado |
| POST | `/api/personas/:id/documentos` — *multipart* | EMPLEADO_DMM+ |
| DELETE | `/api/personas/:id/documentos/:documentoId` | EMPLEADO_DMM+ |

`POST /api/personas` acepta la persona junto con `discapacidadIds`, `encargados`
(existentes o nuevos) y `contactos` en **una sola transacción**. Un menor sin DPI
sin encargado es rechazado por un constraint diferido de la base, con mensaje
claro.

La búsqueda combina `ILIKE` con `similarity`; **no tolera diferencias de tildes**
(«maria» no encuentra «María»).

## Insumos e inventario

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/insumos` — `?categoriaId=` `?busqueda=` `?incluirInactivos=` | autenticado |
| GET | `/api/insumos/:id` · `/api/insumos/:id/stock` | autenticado |
| POST · PATCH | `/api/insumos[/:id]` | DIRECTORA, ADMINISTRADOR |
| PATCH | `/api/insumos/:id/desactivar` · `/reactivar` | DIRECTORA, ADMINISTRADOR |
| GET | `/api/insumos/:id/presentaciones` | autenticado |
| POST · PATCH | `/api/insumos/:id/presentaciones[/:presentacionId]` | DIRECTORA, ADMINISTRADOR |
| PATCH | `.../presentaciones/:presentacionId/desactivar` · `/reactivar` | DIRECTORA, ADMINISTRADOR |
| GET | `/api/inventario/semaforo` — `?insumoId=` `?semaforo=` | autenticado |
| POST | `/api/inventario/lotes/:loteId/baja` | EMPLEADO_DMM+ |

Los tres flags (`requiere_fecha_caducidad`, `requiere_codigo_fabricante`,
`bloquea_solicitud_sin_stock`) viven en **insumo**, no en la categoría.
La unicidad de insumo es `(nombre, categoria_id)`: el mismo nombre puede
repetirse en categorías distintas.

Cada insumo tiene **una sola presentación por defecto**, garantizado por un
índice único parcial de la base. La primera presentación se marca por defecto
automáticamente; para cambiarla, marque otra.

`semaforo`: `VENCIDO` · `ROJO` (< 3 meses) · `AMARILLO` (< 6 meses) · `VERDE` ·
`GRIS` (sin caducidad).

### Recepción de donaciones

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/recepciones` — `?institucionId=` `?incluirInactivas=` | autenticado |
| GET | `/api/recepciones/:id` — cabecera + lotes + documentos | autenticado |
| POST · PATCH | `/api/recepciones[/:id]` | EMPLEADO_DMM+ |
| PATCH | `/api/recepciones/:id/desactivar` · `/reactivar` | EMPLEADO_DMM+ |
| GET · POST | `/api/recepciones/:id/lotes` | EMPLEADO_DMM+ |
| GET | `/api/recepciones/:id/documentos` | autenticado |
| POST | `/api/recepciones/:id/documentos` — *multipart* | EMPLEADO_DMM+ |
| DELETE | `/api/recepciones/:id/documentos/:documentoId` | EMPLEADO_DMM+ |

Al registrar un lote **no se envían** `cantidad_inicial` ni
`cantidad_disponible`: un trigger las calcula como
`FLOOR(cantidad_recepcion_original × unidades_por_presentacion_lote)`. El backend
manda `insumo_id`, `presentacion_recepcion_id`, `cantidad_recepcion_original`,
`unidades_por_presentacion_lote`, y opcionalmente `marca_id`, `fecha_caducidad`,
`codigo_lote_fabricante`, `observaciones`.

Tras cada lote se invoca `sp_procesar_donacion_pendientes`, que promueve las
líneas de solicitud que esperaban ese insumo.

## Solicitudes de apoyo

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/solicitudes` — `?personaId=` `?programaId=` `?estadoLinea=` `?soloPendientesAprobacion=` | autenticado |
| GET | `/api/solicitudes/lista-espera` — `?insumo=` | autenticado |
| GET | `/api/solicitudes/:id` — cabecera + líneas + recetas | autenticado |
| POST · PATCH | `/api/solicitudes[/:id]` | EMPLEADO_DMM+ |
| POST | `/api/solicitudes/:id/aprobar` · `/rechazar` | **DIRECTORA, ADMINISTRADOR** |
| POST | `/api/solicitudes/:id/cancelar` | EMPLEADO_DMM+ |
| GET · POST | `/api/solicitudes/:id/lineas` | EMPLEADO_DMM+ |
| PATCH | `/api/solicitudes/:id/lineas/:lineaId` | EMPLEADO_DMM+ |
| POST | `/api/solicitudes/:id/lineas/:lineaId/cancelar` | EMPLEADO_DMM+ |
| GET | `/api/solicitudes/:id/recetas` | autenticado |
| POST | `/api/solicitudes/:id/recetas` — *multipart* | EMPLEADO_DMM+ |
| DELETE | `/api/solicitudes/:id/recetas/:recetaId` | EMPLEADO_DMM+ |

`POST /api/solicitudes` crea cabecera y líneas en una transacción. **Los estados
de las líneas los asigna la base**, según el stock real del insumo:
`PENDIENTE_ENTREGA` si hay, `PENDIENTE_ADQUISICION` si no.

Si un insumo tiene `bloquea_solicitud_sin_stock` y no hay existencias, la
respuesta es **409** con el mensaje del trigger, y **no queda cabecera huérfana**.

Aprobar no cambia `estado_id`: `aprobada` es una columna aparte y el estado
refleja el avance del despacho. Rechazar cancela las líneas pendientes y deja la
cabecera en `RECHAZADA`.

## Entregas

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/entregas` — `?personaId=` `?insumoId=` `?desde=` `?hasta=` `?incluirAnuladas=` | autenticado |
| GET | `/api/entregas/lotes-fifo?insumoId=` | autenticado |
| GET | `/api/entregas/:id` — cabecera + de qué lotes salió + evidencias | autenticado |
| POST | `/api/entregas` | EMPLEADO_DMM+ |
| POST | `/api/entregas/:id/anular` | **DIRECTORA, ADMINISTRADOR** |
| GET | `/api/entregas/:id/evidencias` | autenticado |
| POST | `/api/entregas/:id/evidencias` — *multipart* | EMPLEADO_DMM+ |
| DELETE | `/api/entregas/:id/evidencias/:evidenciaId` | EMPLEADO_DMM+ |

`POST /api/entregas`: `{ persona_id, insumo_id, cantidad }`, más opcionalmente
`detalle_solicitud_id`, `persona_receptor_id` + `tipo_parentesco_receptor_id`
(obligatorio si hay receptor), y `observaciones`.

La base elige los lotes en orden **FEFO con respaldo FIFO** (caducidad más
próxima; los sin caducidad al final) y descuenta el stock con bloqueo de fila. El
backend no elige lotes. `lotes-fifo` permite previsualizar ese orden.

Anular devuelve las cantidades **a cada lote de origen**, no a un total agregado.

## Préstamos y multas

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/contratos` — `?estado=` `?personaId=` `?incluirInactivos=` | autenticado |
| GET | `/api/contratos/vencidos` | autenticado |
| POST | `/api/contratos/marcar-vencidos` | DIRECTORA, ADMINISTRADOR |
| GET | `/api/contratos/:id` — con multas y cadena de renovaciones | autenticado |
| POST · PATCH | `/api/contratos[/:id]` | EMPLEADO_DMM+ |
| POST | `/api/contratos/:id/renovar` · `/devolucion` | EMPLEADO_DMM+ |
| POST | `/api/contratos/:id/documento` — *multipart* | EMPLEADO_DMM+ |
| GET | `/api/contratos/:id/multas` — `?incluirAnuladas=` | autenticado |
| POST · PATCH | `/api/contratos/:id/multas[/:multaId]` | **DIRECTORA, ADMINISTRADOR** |
| POST | `/api/contratos/:id/multas/:multaId/pagar` · `/anular` | **DIRECTORA, ADMINISTRADOR** |

Un contrato nace de un renglón de entrega (`detalle_entrega_id`). Una renovación
nace del contrato anterior y **no tiene entrega propia**; el anterior queda en
`EXTENDIDO`. La cadena es lineal: un contrato admite una sola renovación.

La devolución se registra sobre el **último contrato de la cadena**; el backend
resuelve el contrato raíz para devolver el equipo al lote correcto.

`vencidos` se calcula por fechas, no por `estado_id`: nada en la base mueve ese
estado por sí solo. `marcar-vencidos` lo sincroniza y puede invocarse desde un
cron.

Al aplicar una multa, si no se envía `monto` se toma el `monto_sugerido` del tipo.

## Reportes

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/reportes/personas-atendidas` | **DIRECTORA, ALCALDE, ADMINISTRADOR** |
| GET | `/api/reportes/stock-por-categoria` | **DIRECTORA, ALCALDE, ADMINISTRADOR** |
| GET | `/api/reportes/poblacion-beneficiada` | **DIRECTORA, ALCALDE, ADMINISTRADOR** |

Único módulo donde entra `ALCALDE`, y no hay ningún endpoint de escritura, así
que su acceso es de solo lectura por construcción. `EMPLEADO_DMM` queda fuera.

Los tres aceptan `?formato=json|xlsx|pdf`. En `xlsx` y `pdf` la respuesta es el
archivo con `Content-Disposition: attachment`.

Filtros de `personas-atendidas`: `desde`, `hasta`, `comunidadId`,
`discapacidadId`, `programaId`, `genero`, `edadMin`, `edadMax`,
`soloAdultoMayor`, `soloConDiscapacidad`. La edad es **la que tenía a la fecha de
la entrega**, no la actual.

## Usuarios

| Método | Ruta | Acceso |
|---|---|---|
| PATCH | `/api/usuarios/mi-password` | autenticado |
| GET | `/api/usuarios` — `?rolId=` `?busqueda=` `?incluirInactivos=` | **ADMINISTRADOR** |
| GET · POST · PATCH | `/api/usuarios[/:id]` | **ADMINISTRADOR** |
| PATCH | `/api/usuarios/:id/desactivar` · `/reactivar` | **ADMINISTRADOR** |
| PATCH | `/api/usuarios/:id/password` | **ADMINISTRADOR** |

No hay registro público, por diseño. `password_hash` no aparece en ninguna
respuesta.

Contraseña: mínimo 8 caracteres, con al menos una letra y un número.

`mi-password` exige `password_actual` y conserva la sesión desde la que se hace el
cambio, revocando las demás. El reseteo por administrador no pide la actual y
revoca **todas** las sesiones del usuario.

Guardas: no se puede cambiar el propio rol, desactivarse a uno mismo, ni
desactivar o cambiar el rol del único `ADMINISTRADOR` activo.

## Auditoría

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/auditoria` — `?tabla=` `?registroId=` `?usuarioId=` `?accion=` `?desde=` `?hasta=` | **ADMINISTRADOR** |
| GET | `/api/auditoria/tablas` | **ADMINISTRADOR** |
| GET | `/api/auditoria/:tabla/:registroId` | **ADMINISTRADOR** |

Solo lectura: los triggers de la base son los únicos que escriben. `accion` es
`INSERT`, `UPDATE` o `DELETE`.

`password_hash` y `token_hash` se devuelven como `[redactado]`: la función de
auditoría guarda la fila completa y esos campos son material de credenciales.

## Archivos

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/archivos/<ruta>` | autenticado |

La `ruta` es la que devolvió el endpoint que subió el archivo (por ejemplo
`documentos-persona/uuid.jpg`). Protegido por sesión: los documentos de
identificación no deben ser accesibles sin autenticar.

Subidas: máximo **8 MB**; se aceptan JPG, PNG, WEBP y PDF, validados por **firma
binaria** y no por extensión. Las imágenes se recomprimen a JPEG y se
redimensionan a 1600 px. El nombre en disco lo genera el servidor (UUID). El
borrado es lógico: el archivo permanece en disco.
