# Tasks / Backlog

Derivado de la revisión de arquitectura del script completo (1465 líneas,
pre-split) y la estructura del Sheet. Nada de esto es urgente — son mejoras
de escalabilidad y mantenibilidad, no bugs activos que rompan el uso diario
de Héctor/Angy hoy.

## ✅ Hecho

- [x] **Versionar con git + clasp.** `clasp` instalado, proyecto conectado,
      `.claspignore` configurado. (commit "Split inicial", 2026-09-22)
- [x] **Romper el monolito en módulos por responsabilidad.** Un solo
      `.gs` dividido en `src/Config.gs`, `Webhook.gs`, `Pipeline.gs`,
      `Classifier.gs`, `Catalogo.gs`, `CalendarService.gs`,
      `TasksService.gs`, `Sesiones.gs`, `NotasPendientes.gs`, `Ayuda.gs`,
      `WhatsAppApi.gs`, `Logging.gs`, `Email.gs`, `Triggers.gs`. Puramente
      organizativo — Apps Script junta todo en un namespace global, no
      cambió comportamiento. Ver [architecture.md](architecture.md).
- [x] **Repo subido a GitHub** (`hramirez-pixel/NexusVoice-os`, branch `main`).

## Pendiente

### Entornos dev / prod
Hoy solo existe un proyecto de Apps Script y recibe WhatsApp real de
Héctor/Angy — cualquier cambio se prueba en vivo. Montar un segundo proyecto
Apps Script + segundo Sheet (o pestaña de prueba) + número de prueba de
WhatsApp (Meta lo da gratis en modo desarrollo), con
`.clasp.dev.json`/`.clasp.prod.json` para apuntar `clasp push -f` a uno u
otro. Documentado ya en README sección 6, falta ejecutarlo.

### Centralizar el acceso al Sheet
`SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)` está repetido en 6+
funciones (cada una vuelve a abrir el spreadsheet) y los nombres de pestaña
van como strings sueltos por todo el código. Reemplazar por:

```js
function getSS() {
  if (!getSS._ss) getSS._ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return getSS._ss;
}
function getSheet(name) {
  const s = getSS().getSheetByName(name);
  if (!s) throw new Error(`Hoja no encontrada: ${name}`);
  return s;
}
```

y definir los nombres como constantes (`SHEETS.AUDITORIA`, `SHEETS.SESIONES`,
etc.) en `Config.gs` en vez de strings repetidos.

### Fix: `sender_phone` con tipo inconsistente
En `Sesiones`, `sender_phone` a veces se guarda como número
(`5214431025894.0`) en vez de string, mientras `CONFIG.USUARIOS` usa las
claves como string. Mismo patrón de bug que el de fechas ya arreglado en
v3.14 (Sheets auto-convirtiendo tipos al escribir). Forzar `.toString()` en
cualquier punto donde se compare un teléfono, en vez de confiar en
comparación implícita o `===`.

### Sacar `CONFIG.USUARIOS` del código a una hoja
Agregar una persona nueva (o un calendario de trabajo nuevo, ej. para Angy)
hoy requiere editar `CONFIG.USUARIOS` en `Config.gs` y redesplegar. Mover a
una pestaña `Usuarios` (columnas: `telefono, nombre, calendario, lista,
trabajo, correo`), igual que ya existe `Catalogo_Listas`, para que agregar
a alguien sea una fila nueva y no un deploy.

### Testing mínimo
Apps Script no tiene test runner nativo (no hay Jest fácil contra
`SpreadsheetApp`). Dos frentes viables:

1. Separar la lógica **pura** (parseo de fechas, `resolverDestinoCalendario`,
   `normalizarCorreoHablado`, `esCorreoValido`) de la que toca
   Sheets/Calendar/WhatsApp — la pura se puede probar con Node en local
   (clasp no lo impide, es JS normal).
2. Funciones `test_*()` dentro del propio Apps Script, corridas manualmente
   desde el editor contra el entorno de **dev** (ver arriba), como smoke
   test antes de cada `clasp deploy`.
