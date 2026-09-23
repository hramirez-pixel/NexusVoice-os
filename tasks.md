# Tasks / Backlog

Derivado de la revisión de arquitectura del script completo (1465 líneas,
pre-split) y la estructura del Sheet. Nada de esto es urgente — son mejoras
de escalabilidad y mantenibilidad, no bugs activos que rompan el uso diario
de Héctor/Angy hoy.

## ✅ Hecho

- [x] **CRUD completo de citas y tareas por WhatsApp** (antes solo existía
      "alta"): `CANCELAR_CITA` y `EDITAR_COMENTARIO_CITA` (Sesiones.gs:
      `cancelarCitaEnCalendar`, `editarComentarioEvento`) para citas; y
      `ELIMINAR_TAREA`/`EDITAR_NOTA_TAREA` (TasksService.gs:
      `eliminarTareaPorTitulo`, `editarNotaTareaPorTitulo`, ambos reusando
      `buscarTareaAbiertaPorTitulo`) para tareas — distinto de
      `COMPLETAR_TAREA` (que SÍ cierra la tarea). Se extrajeron dos helpers
      compartidos para no duplicar lógica entre los 6 comandos que operan
      sobre una sesión/tarea existente: `resolverSesionDesdeComando()`
      (Sesiones.gs, por ID/fecha-título/contexto reciente) y
      `resolverUsuarioYDestino()` (Config.gs, agenda compartida). Ejemplos de
      frase por comando en `getMensajeAyuda()` (`Ayuda.gs`) — o escribiendo
      "ayuda" por WhatsApp.
- [x] **CRÍTICO — `clasp push` no publicaba al webhook real de WhatsApp.**
      Todos los fixes de una sesión completa (agenda unificada, agenda
      compartida, `COMPLETAR_TAREA`, fechas pasadas/mes explícito, alias de
      Angy) se subieron con `clasp push` y no se veían reflejados al probar
      por WhatsApp — porque `clasp push` solo actualiza el editor (HEAD), y
      el despliegue de Web App que Meta realmente llama está fijado a una
      versión específica (`AKfycbz...@32` en este caso). Se detectó
      comparando `debug_clasificar()` (corre desde el editor, veía el fix
      ya bien) contra el comportamiento real por WhatsApp (seguía viendo el
      código viejo). Se corrigió con `clasp deploy -i <deployment-id>` (→
      versión 33, misma URL). Documentado en README sección 8 y en
      `claude.md` como paso obligatorio de aquí en adelante — **cada cambio
      que deba quedar visible por WhatsApp necesita `clasp push` Y `clasp
      deploy -i <id>`, no solo lo primero.**
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
- [x] **`clasp` conectado al proyecto real** (`.clasp.json` + login), con fix de
      `.claspignore` (los patrones son relativos a `rootDir: "src"`, no a la
      raíz del repo — antes ignoraba todo el proyecto).
- [x] **Nuevo intent `CONSULTAR_AGENDA`.** Permite preguntar "qué tengo hoy" /
      "cómo se ve mi agenda del viernes" y leer el calendario REAL de Google
      (`CalendarService.getEventosEnRango`), no solo lo que este bot creó —
      a diferencia de `CONSULTAR_PENDIENTES`, que sigue leyendo el registro
      interno en `Sesiones`.
- [x] **Calendarios de trabajo/personal de Angy registrados** en
      `Catalogo_Listas` (`AngyPersonal`, `AngyTrabajo`) y en
      `CONFIG.USUARIOS` (`trabajo: "AngyTrabajo"`) — mismo patrón que ya
      tenía Héctor desde v3.14. Listas de tareas de ambos unificadas
      (`HectorPendientes`, `AngyPendientes`) sin importar el destino.
- [x] **Agenda compartida: `CONSULTAR_AGENDA` con `persona_agenda`.** Permite
      preguntar "qué tiene Angy hoy" / "agenda de Héctor mañana" —
      `getUsuarioPorNombre()` en `Config.gs` resuelve el nombre a su perfil
      registrado (calendario/trabajo/personal), y `Pipeline.gs` responde con
      un mensaje de error listando los nombres válidos si no reconoce a
      quien se menciona. Pendiente de probar en vivo: qué tan detallados
      vienen los eventos según el nivel de permiso que cada quien le dio a
      su calendario compartido (Google filtra esto solo — "ver
      ocupado/libre" vs. "ver todos los detalles" — no es algo que el
      código controle).
- [x] **Fix: fechas pasadas no resolvían ("qué tenía ayer" → "no tienes
      nada").** `getTablaProximosDias` solo generaba fechas hacia adelante;
      "ayer"/"antier"/"la semana pasada" no existían en la tabla que ve el
      clasificador, así que `rango_desde`/`rango_hasta` quedaban en `null` y
      caían al fallback de "hoy" en silencio. Ahora la tabla incluye también
      7 días hacia atrás.
- [x] **Fix: nombre de persona confundido con destino en `CONSULTAR_AGENDA`.**
      Red de seguridad en `Pipeline.gs` — si el clasificador pone el nombre
      de una persona registrada en `destino_agenda` en vez de
      `persona_agenda` (son fáciles de confundir), se detecta y se trata
      como persona igual.
- [x] **`CONSULTAR_AGENDA` unifica Calendar + Tasks.** Antes solo traía
      eventos de Calendar; las tareas vencidas (ej. "2 pendientes vencidos
      de ayer") no aparecían porque viven en Google Tasks, un servicio
      aparte. Ahora `getTareasEnRango()` (`TasksService.gs`) trae también las
      tareas no completadas con vencimiento en el mismo rango, marcadas
      "Vencida" si su fecha ya pasó.
- [x] **Fusión `CONSULTAR_PENDIENTES` + `CONSULTAR_AGENDA` en un solo motor.**
      "Mis pendientes" seguía leyendo SOLO el registro interno (`Sesiones`)
      — por eso no veía tareas creadas directo en Google Tasks, ni permitía
      preguntar por otra persona en absoluto. Ahora ambas frases ("pendientes"
      y "agenda") ejecutan exactamente el mismo código (estado real de
      Calendar + Tasks, con soporte de agenda compartida). Se retiró
      `findSesionesEnRango` (quedó sin uso) y se reescribió
      `construirCuerpoCorreoPendientes` → `construirCuerpoCorreoAgenda` en
      `Email.gs` para trabajar con el nuevo formato. Las IDs cortas
      (`ID-00X`) para gestionar invitados siguen funcionando igual —viven en
      `AGREGAR_INVITADO`, que ya buscaba por fecha/título como alternativa.

- [x] **Angy con dos correos registrados** (gmail + hotmail, separados por
      coma en `CONFIG.USUARIOS.correo` — `MailApp.sendEmail` manda a todos
      los que vengan en esa lista).
- [x] **Recordatorio nocturno de notas pendientes ahora también por correo**
      (`sendRecordatorioNotasPendientes` en `Triggers.gs`), mismo patrón que
      el resumen diario — antes solo se mandaba por WhatsApp.
- [x] **Fix: rangos de fecha explícitos ("todos los pendientes de
      septiembre") no resolvían.** La tabla de fechas del clasificador solo
      cubre ~1 mes (7 días atrás, 21 adelante); un mes completo fuera de esa
      ventana no tenía cómo resolverse y caía al fallback de "hoy" en
      silencio. Ahora el prompt permite que el modelo calcule directamente
      fechas/rangos EXPLÍCITOS (mes, "del 1 al 15", etc.) sin depender de la
      tabla — la tabla sigue siendo obligatoria solo para referencias
      relativas por nombre de día.
- [x] **Fix: alias de nombre para agenda compartida ("Angie" → Angy).**
      `getUsuarioPorNombre` comparaba solo contra el nombre exacto — "Angie"
      (variante natural de "Angy") no coincidía, y en vez de dar el mensaje
      de "no reconozco a...", el clasificador omitía la persona en silencio
      y consultaba la propia agenda del remitente. Ahora `CONFIG.USUARIOS`
      soporta un campo `alias` (`["Angie", "Angélica", "Angelica"]` para
      Angy) reconocido tanto por el código como por el prompt del
      clasificador.

- [x] **Nuevo intent `COMPLETAR_TAREA`.** Permite avisar que una tarea ya
      creada se terminó ("ya hice lo de enviar reportes", "márcalo como
      hecho, nota: se mandó por correo") y dejarle una nota. Como las tareas
      no tienen ID corto (a diferencia de las citas en `Sesiones`), se
      buscan por título aproximado (`completarTareaPorTitulo()` en
      `TasksService.gs`) — si hay 0 o varias coincidencias, avisa en vez de
      adivinar. Soporta agenda compartida igual que `CONSULTAR_AGENDA`
      (puede completar una tarea de otra persona registrada).

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

### Decisión: Google Sheets vs. Supabase como base de datos
**No migrar por ahora.** El cuello de botella actual no es el motor de
datos — es `SpreadsheetApp.openById()` repetido sin cachear (ver
"Centralizar el acceso al Sheet" arriba). Arreglar eso da más velocidad
percibida que cambiar de motor. Migrar a Supabase implicaría reescribir
todo el acceso a datos (`Sesiones.gs`, `NotasPendientes.gs`, `Logging.gs`,
`Catalogo.gs`), sumar autenticación de servicio, y perder la edición manual
del Sheet que hoy se usa para revisar/corregir filas a mano — a cambio de
algo que con 2 usuarios reales no se nota en desempeño.

**Señal de disparo para reconsiderar:** cuando `getDataRange().getValues()`
en `Sesiones`/`Auditoria_Logs` empiece a sentirse lento por volumen real de
filas (cientos de miles, no cientos), o cuando se necesiten queries reales
(joins, filtros de fecha eficientes) en vez de recorrer arrays en Apps
Script. Con el volumen actual (uso personal de 2 personas) está lejos.

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
