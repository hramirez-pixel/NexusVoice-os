# Architecture

## Flujo de un mensaje

```
WhatsApp (Meta Cloud API)
        │
        ▼
  Webhook.gs          doGet (verificación) / doPost (entrada)
        │
        ▼
  Pipeline.gs          processIncomingAudio / processTextCommand / handleTextMessage
        │
        ├──▶ WhatsAppApi.gs     fetchWhatsAppAudioBlob, transcribeAudioWithWhisper (Whisper)
        │
        ▼
  Classifier.gs         classifyIncomingMessage (GPT-4o-mini) → intención + datos extraídos
        │
        ├──▶ Catalogo.gs         resuelve nombre dicho → ID real de calendario/lista
        ├──▶ CalendarService.gs  createCalendarEvent, getCalendarPorNombre
        ├──▶ TasksService.gs     createGoogleTask, getTaskListIdPorNombre
        ├──▶ Sesiones.gs         logSesion, findSesionById/ByFecha/EnRango, addGuestToSesion
        ├──▶ NotasPendientes.gs  logToNotasPendientes, findNotaByIdCorto, marcarNotaResuelta
        │
        ▼
  WhatsAppApi.gs         sendWhatsAppMessage (respuesta al usuario)
  Logging.gs             logToDatabase / logComandoToDatabase / logErrorToDatabase
  Email.gs                                         (resumen diario / bajo demanda)
  Triggers.gs            sendDailySummary, sendRecordatorioNotasPendientes (time-driven)
```

**Nota clave:** Apps Script junta todos los `.gs` de `src/` en un único
namespace global en tiempo de ejecución — no hay `import`/`export`. La
separación en archivos es puramente organizativa (para git y legibilidad),
no afecta el comportamiento ni el orden de carga.

## Módulos (`src/`)

| Archivo | Responsabilidad |
|---|---|
| `Config.gs` | `CONFIG`, `ALIAS_TRABAJO`/`ALIAS_PERSONAL`, `getUsuario()`, `resolverDestinoCalendario()` |
| `Webhook.gs` | `doGet`, `doPost` — punto de entrada HTTP |
| `Pipeline.gs` | Orquesta audio/texto entrante hasta despachar a los servicios correspondientes |
| `Classifier.gs` | Prompt y llamada a OpenAI para clasificar intención del mensaje |
| `Catalogo.gs` | Resolución de nombres hablados → IDs de calendario/lista (pestaña `Catalogo_Listas`) |
| `CalendarService.gs` | Crear eventos, parseo de fecha/hora |
| `TasksService.gs` | Crear tareas, resolución de listas de tareas |
| `Sesiones.gs` | CRUD sobre la pestaña `Sesiones`: IDs cortos, invitados, búsquedas por ID/fecha/rango |
| `NotasPendientes.gs` | Notas ambiguas que el clasificador no pudo resolver del todo |
| `Ayuda.gs` | Mensaje de ayuda para el usuario final |
| `WhatsAppApi.gs` | Descarga de audio, transcripción (Whisper), envío de mensajes |
| `Logging.gs` | Escritura en `Auditoria_Logs` |
| `Email.gs` | Envío de correo (resumen diario, respaldo bajo demanda) |
| `Triggers.gs` | Disparadores por tiempo: resumen diario, recordatorio de notas, tip de uso |

## Modelo de datos (Google Sheets, `CONFIG.SPREADSHEET_ID`)

| Pestaña | Para qué |
|---|---|
| `Auditoria_Logs` | Log de todo lo procesado (mensajes, comandos, errores) |
| `Sesiones` | Una fila por cita/tarea creada: `id_sesion, tipo, event_id, calendar_o_lista_id, titulo, fecha_hora, sender_phone, estado, invitados, created_at` |
| `Notas_Pendientes` | Notas ambiguas sin resolver, con ID corto `N-XXX` |
| `Catalogo_Listas` | Catálogo de nombres → IDs de calendario/lista de Google |

`fecha_hora` y `created_at` en `Sesiones` se fuerzan a formato texto
(`setNumberFormat('@')`) porque Sheets auto-convierte strings con forma de
fecha a un valor `Date` real al escribirlos con `appendRow` — ver
`normalizarValorFecha()` en `Sesiones.gs` y el fix de v3.14 en
[context.md](context.md).

## Deuda técnica conocida

Ninguno de estos puntos es un bug activo hoy, pero son la fricción principal
para escalar el proyecto. Detalle y prioridad en [tasks.md](tasks.md).

1. **Acceso a la hoja repetido:** `SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)`
   aparece suelto en 6+ funciones distintas (cada llamada abre el spreadsheet
   de nuevo) en vez de pasar por un único punto de acceso cacheado.
2. **Nombres de pestaña como strings sueltos** (`"Auditoria_Logs"`,
   `"Sesiones"`, etc.) repartidos por el código en vez de constantes
   centralizadas — renombrar una pestaña rompe en silencio.
3. **`sender_phone` con tipo inconsistente:** Sheets a veces guarda el
   teléfono como número (`5214431025894`) en vez de texto, mientras
   `CONFIG.USUARIOS` usa las claves como string. Cualquier comparación con
   `===` en vez de `.toString()` falla en silencio para ese usuario.
4. **`CONFIG.USUARIOS` hardcodeado en `Config.gs`:** agregar una persona
   nueva (o un calendario de trabajo) requiere editar código y redesplegar,
   en vez de agregar una fila en el Sheet.
5. **Sin test runner nativo** (Apps Script no corre Jest): la lógica pura
   (parseo de fechas, `resolverDestinoCalendario`, `normalizarCorreoHablado`,
   `esCorreoValido`) es candidata a extraerse y probarse con Node en local;
   el resto solo puede probarse con smoke tests manuales (`test_*()`) contra
   un entorno de desarrollo.
