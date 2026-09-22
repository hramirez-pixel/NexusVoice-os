# Context

## Para quién existe esto

Uso personal/familiar: Héctor y Angy mandan notas de voz (o texto) por
WhatsApp a un mismo número, y NexusVoice les agenda citas en su propio
Google Calendar o crea tareas en su propia lista de Google Tasks, según lo
que dijeron. No es un producto multi-tenant genérico — el multi-usuario que
existe es exactamente para estas dos personas compartiendo una instancia.

## Multi-usuario en una sola instancia (desde v3.13)

`CONFIG.USUARIOS` (en `Config.gs`) mapea el teléfono remitente a un perfil
(`nombre`, `calendario`, `lista`, opcionalmente `trabajo`, `correo`). Un
número no registrado cae en `CONFIG.USUARIO_DEFAULT`. Esto permite:

- Que "pendientes" y "notas pendientes" no se mezclen entre personas
  (`findSesionesEnRango`, `findSesionesByFecha` filtran por `sender_phone`
  cuando se les pasa).
- Que una misma cita no pueda ser modificada por otra persona adivinando su
  ID corto (`findSesionById` valida `sender_phone`).
- Que decir "trabajo" o "personal" en voz (v3.14) resuelva automáticamente
  al calendario de **quien habla**, sin que nadie tenga que decir su propio
  nombre — ver `ALIAS_TRABAJO`/`ALIAS_PERSONAL` y `resolverDestinoCalendario()`
  en `Config.gs`. Cualquier otro destino dicho (ej. "Proyecto",
  "CustomerSuccess") es compartido y se usa tal cual.

## Por qué el código llegó así (resumen del changelog, v3.4 → v3.14)

El historial completo vive como comentario al inicio de `src/Config.gs`;
lo relevante para entender decisiones actuales:

- **v3.6:** ID corto por cita/tarea (`ID-XXX`) + poder agregar invitados por
  WhatsApp después de crear la cita (por ID, por fecha/hora, o por contexto
  reciente) → nace la pestaña `Sesiones`.
- **v3.9:** un solo clasificador (`classifyIncomingMessage`) para audio y
  texto, que entiende sinónimos y variantes de frase por significado, no por
  texto exacto.
- **v3.10 / v3.11:** fechas relativas dichas en voz ("el próximo jueves", "la
  próxima semana el miércoles") fallaban porque el modelo calculaba offsets
  de días por su cuenta. Se le pasa en cambio una tabla ya calculada de los
  próximos 21 días — el modelo solo busca el nombre del día ahí, nunca
  calcula.
- **v3.12:** el Phone Number ID de WhatsApp se saca de estar fijo dentro de
  `sendWhatsAppMessage` a `CONFIG.WHATSAPP_PHONE_NUMBER_ID`, pensando ya en
  poder tener varias instancias (una por persona/cuenta) sin riesgo de dejarlo
  mal copiado en algún lado.
- **v3.13:** soporte multi-usuario dentro de una sola instancia (ver sección
  arriba) + canal de correo como respaldo del WhatsApp (resumen diario o "mándame
  lo de hoy por correo" bajo demanda), recomendado como un solo correo
  combinado citas+tareas en vez de dos.
- **v3.14:** alias "trabajo"/"personal" resueltos automáticamente por quien
  habla, y fix de raíz de un bug donde Google Sheets auto-convertía fechas
  guardadas como texto a un valor `Date` real, rompiendo comparaciones de
  rango en "consultar pendientes" — ver `normalizarValorFecha()` en
  `Sesiones.gs`.

## Integraciones externas

| Servicio | Para qué | Dónde vive el secreto |
|---|---|---|
| WhatsApp Cloud API (Meta) | Canal de entrada/salida | Script Properties del proyecto Apps Script (`WHATSAPP_TOKEN`) |
| OpenAI Whisper | Transcripción de audio | Script Properties (`OPENAI_API_KEY`) |
| OpenAI GPT-4o-mini | Clasificación de intención | mismo `OPENAI_API_KEY` |
| Google Calendar / Tasks | Destino final de citas/tareas | Auth nativo de Apps Script (cuenta de Google del proyecto) |
| Gmail | Resumen diario / respaldo bajo demanda | Auth nativo de Apps Script |
| Google Sheets | Base de datos completa del sistema | `CONFIG.SPREADSHEET_ID` |

Las API keys **nunca** van en el código ni en git — viven en *Script
Properties* de cada proyecto de Apps Script (ver sección 7 de
[README.md](README.md)).

## Entornos

Hoy solo existe **un** proyecto de Apps Script, en producción, atendiendo el
número real de WhatsApp de Héctor y Angy. No hay entorno de pruebas
separado todavía — cualquier cambio se prueba directamente contra el canal
real. La separación dev/prod (segundo proyecto Apps Script + segundo Sheet +
número de prueba de WhatsApp + `.clasp.dev.json`/`.clasp.prod.json`) está
documentada en el README (sección 6) pero pendiente de montarse — ver
[tasks.md](tasks.md).
