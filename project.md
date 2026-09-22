# NexusVoice OS — Project

## Qué es

Asistente personal por WhatsApp para Héctor y Angy. Reciben un audio o texto,
NexusVoice lo transcribe (Whisper), clasifica la intención (GPT-4o-mini) y
crea/consulta citas en Google Calendar y tareas en Google Tasks. Todo el
estado (auditoría, sesiones, notas pendientes, catálogo de destinos) vive en
un Google Sheet, y Apps Script es el runtime — no hay servidor propio.

## Estado actual

- **Versión:** v3.14 (ver el changelog dentro de `src/Config.gs` para el
  historial completo de fixes desde v3.4).
- **Instancia:** una sola, en producción, atendiendo el número real de
  WhatsApp de Héctor y Angy. No existe todavía un entorno de pruebas separado
  (ver [tasks.md](tasks.md)).
- **Código:** recién dividido de un único script monolítico a módulos por
  responsabilidad dentro de `src/` (commit "Split inicial", 2026-09-22). El
  comportamiento no cambió — es reorganización pura para poder versionar con
  git y trabajar en local con `clasp`.

## Stack

| Pieza | Herramienta |
|---|---|
| Runtime | Google Apps Script (`src/*.gs`) |
| Versionado local | `clasp` (`@google/clasp`) + git |
| Base de datos | Google Sheets (4 pestañas — ver [architecture.md](architecture.md)) |
| Transcripción | OpenAI Whisper |
| Clasificación de intención | OpenAI GPT-4o-mini |
| Calendario / tareas | Google Calendar API, Google Tasks API |
| Canal de entrada/salida | WhatsApp Cloud API (Meta) |
| Respaldo | Gmail (resumen diario, envío bajo demanda) |

## Dónde mirar según lo que necesites

- **Cómo instalar y desplegar:** [README.md](README.md).
- **Cómo está organizado el código y el modelo de datos:** [architecture.md](architecture.md).
- **Por qué existen ciertas decisiones (multi-usuario, alias, fixes de fecha/teléfono):** [context.md](context.md).
- **Qué falta / deuda técnica pendiente:** [tasks.md](tasks.md).
