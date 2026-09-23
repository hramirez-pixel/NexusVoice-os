function getOrCreateSesionesSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SESIONES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SESIONES_SHEET_NAME);
    sheet.appendRow(['id_sesion', 'tipo', 'event_id', 'calendar_o_lista_id', 'titulo', 'fecha_hora', 'sender_phone', 'estado', 'invitados', 'created_at']);
    // FIX v3.14: columnas F (fecha_hora) y J (created_at) como TEXTO PLANO, para que
    // Sheets deje de auto-convertir "2026-09-24 18:00" en un valor de fecha real
    // (ver normalizarValorFecha para el detalle del bug que esto causaba).
    sheet.getRange("F:F").setNumberFormat('@');
    sheet.getRange("J:J").setNumberFormat('@');
  }
  return sheet;
}

/** Genera el siguiente ID corto de forma segura ante llamadas simultáneas (LockService) */
function generateNextShortId(prefix, counterKey) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const props = PropertiesService.getScriptProperties();
    let last = parseInt(props.getProperty(counterKey) || '0', 10);
    last += 1;
    props.setProperty(counterKey, last.toString());
    return prefix + last.toString().padStart(3, '0');
  } finally {
    try { lock.releaseLock(); } catch (e) { /* no-op */ }
  }
}
function generateNextSesionId() { return generateNextShortId(CONFIG.ID_PREFIX, 'LAST_SESION_NUM'); }
// NUEVO: mismo mecanismo de ID corto pero para Notas_Pendientes, prefijo "N-"
function generateNextNotaId() { return generateNextShortId('N-', 'LAST_NOTA_NUM'); }

/** Registra una cita/tarea recién creada en "Sesiones" y devuelve {idSesion, rowIndex} */
function logSesion(tipo, eventId, calOrListId, titulo, fechaHora, senderPhone) {
  try {
    const sheet = getOrCreateSesionesSheet();
    const idSesion = generateNextSesionId();
    const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    const estadoInicial = tipo === 'CITA' ? 'esperando_respuesta' : 'creada';
    sheet.appendRow([idSesion, tipo, eventId, calOrListId || '', titulo, fechaHora || '', senderPhone, estadoInicial, '', timestamp]);
    // FIX v3.9: se devuelve también rowIndex — se necesita para poder marcar
    // "invitado_agregado" cuando el invitado viene en el MISMO audio que la cita.
    return { idSesion: idSesion, rowIndex: sheet.getLastRow() };
  } catch (err) {
    Logger.log("Error registrando sesión: " + err);
    return null;
  }
}

/**
 * FIX v3.11: la gente dicta o escribe correos como "juan punto perez arroba gmail
 * punto com" (o mezclado: "juan.perez.arroba.gmail.com"), y ni el modelo ni el
 * validador lo reconocían como correo. Esta función lo normaliza a formato real
 * ANTES de validar, tanto si viene de audio como si el usuario lo corrige por texto.
 */
function normalizarCorreoHablado(str) {
  if (!str) return str;
  let s = str.toString().trim().toLowerCase();
  s = s.replace(/[\s.]*\barroba\b[\s.]*/g, '@');
  s = s.replace(/[\s.]*\bpunto\b[\s.]*/g, '.');
  s = s.replace(/\s+/g, '');
  return s;
}

/** Valida (de forma simple) que un string tenga forma de correo electrónico */
function esCorreoValido(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.toString().trim());
}

/** Recuerda cuál fue la última sesión creada por este remitente, para la ventana de contexto */
function recordLastSesion(senderPhone, idSesion) {
  PropertiesService.getScriptProperties().setProperty('LAST_SESION_' + senderPhone, JSON.stringify({ id: idSesion, ts: Date.now() }));
}

/** Busca una sesión por su ID exacto (no distingue mayúsculas/minúsculas).
 *  NUEVO v3.13: si se pasa senderPhone y la sesión es de otra persona, no la devuelve
 *  (evita que alguien modifique la cita de otro adivinando/viendo su ID). */
function findSesionById(idSesion, senderPhone) {
  const sheet = getOrCreateSesionesSheet();
  const data = sheet.getDataRange().getValues();
  const target = idSesion.toString().trim().toUpperCase();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim().toUpperCase() === target) {
      const s = rowToSesion(data[i], i + 1);
      if (senderPhone && s.sender_phone && s.sender_phone.toString().trim() !== senderPhone) return null;
      return s;
    }
  }
  return null;
}

/** Busca sesiones por fecha (y opcionalmente por texto aproximado del título).
 *  NUEVO v3.13: si se pasa senderPhone, solo busca entre las sesiones de esa persona. */
function findSesionesByFecha(fechaStr, tituloHint, senderPhone) {
  const sheet = getOrCreateSesionesSheet();
  const data = sheet.getDataRange().getValues();
  const targetDatePart = fechaStr ? fechaStr.toString().trim().substring(0, 10) : null;
  const hint = tituloHint ? tituloHint.toString().toLowerCase().trim() : null;
  const matches = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const s = rowToSesion(row, i + 1); // ya trae fecha_hora normalizada, ver rowToSesion
    const rowFecha = s.fecha_hora.substring(0, 10);
    const rowPhone = s.sender_phone ? s.sender_phone.toString().trim() : '';
    if (targetDatePart && rowFecha !== targetDatePart) continue;
    if (hint && !row[4].toString().toLowerCase().includes(hint)) continue;
    if (senderPhone && rowPhone && rowPhone !== senderPhone) continue;
    matches.push(s);
  }
  return matches;
}

/**
 * FIX v3.14 (causa raíz de "no lee las citas al consultar pendientes"): al guardar
 * "2026-09-24 18:00" con appendRow, Google Sheets AUTO-DETECTA que parece una fecha
 * y la convierte a un valor de fecha real (no texto) — al leerla de vuelta con
 * getValues(), ya no llega como el string "2026-09-24 18:00" sino como un objeto
 * Date de JavaScript, con otro formato al hacer .toString(). Las comparaciones de
 * rango ("2026-09-24" >= "2026-09-21") dejaban de funcionar por eso. Esta función
 * normaliza CUALQUIER valor (string real o Date convertido por Sheets) al mismo
 * formato de texto, sin importar cómo haya quedado guardado en la celda.
 */
function normalizarValorFecha(valor) {
  if (!valor) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return Utilities.formatDate(valor, CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  }
  return valor.toString().trim();
}

function rowToSesion(row, rowIndex) {
  return {
    rowIndex: rowIndex,
    id_sesion: row[0], tipo: row[1], event_id: row[2], cal_o_lista_id: row[3],
    titulo: row[4], fecha_hora: normalizarValorFecha(row[5]), sender_phone: row[6], estado: row[7], invitados: row[8]
  };
}

/**
 * NUEVO — busca una sesión (cita/tarea) a partir de los mismos campos que ya
 * usaba AGREGAR_INVITADO: por ID exacto, por fecha/título aproximado, o por
 * la última sesión creada por este remitente (ventana de contexto). Se
 * reutiliza para cualquier comando que opere sobre una sesión existente
 * (agregar invitado, cancelar cita, editar comentario), para no duplicar
 * esta lógica de búsqueda en cada uno. Devuelve { sesion } o { error }.
 */
function resolverSesionDesdeComando(cmd, senderPhone) {
  if (cmd.id_sesion) {
    const sesion = findSesionById(cmd.id_sesion, senderPhone);
    if (!sesion) return { error: `No encontré ninguna sesión con el ID "${cmd.id_sesion}".` };
    return { sesion: sesion };
  }
  if (cmd.fecha_hora_referencia) {
    const matches = findSesionesByFecha(cmd.fecha_hora_referencia, cmd.titulo_referencia, senderPhone);
    if (matches.length === 0) {
      return { error: `No encontré ninguna cita/tarea el ${cmd.fecha_hora_referencia}. Dame el ID si lo tienes.` };
    }
    if (matches.length > 1) {
      const lista = matches.map(m => `🆔 ${m.id_sesion} - ${m.titulo} (${m.fecha_hora})`).join('\n');
      return { error: `Encontré varias coincidencias, dime el ID exacto:\n\n${lista}` };
    }
    return { sesion: matches[0] };
  }
  // Ventana de contexto: permite referirse a "esa cita" sin ID justo después de crearla
  const lastRaw = PropertiesService.getScriptProperties().getProperty('LAST_SESION_' + senderPhone);
  if (lastRaw) {
    const last = JSON.parse(lastRaw);
    if ((Date.now() - last.ts) / 60000 <= CONFIG.INVITE_WINDOW_MINUTES) {
      const sesion = findSesionById(last.id, senderPhone);
      if (sesion) return { sesion: sesion };
    }
  }
  return { error: 'Ya pasó el tiempo de espera de la última cita (o no hay ninguna reciente). Dame el ID de la sesión (ej. "ID-003") o la fecha/hora de la cita.' };
}

/** Agrega un invitado (correo) a la cita de una sesión — solo aplica a CITA, no a TAREA */
function addGuestToSesion(sesion, email) {
  if (sesion.tipo !== 'CITA') {
    return { ok: false, error: 'esa sesión es una TAREA, y Google Tasks no soporta invitados (solo las citas de Calendar).' };
  }
  try {
    const cal = CalendarApp.getCalendarById(sesion.cal_o_lista_id);
    if (!cal) return { ok: false, error: `no encontré el calendario de esa cita (${sesion.cal_o_lista_id}).` };
    const event = cal.getEventById(sesion.event_id);
    if (!event) return { ok: false, error: 'no encontré el evento en el calendario (¿lo borraste?).' };
    event.addGuest(email);
    return { ok: true };
  } catch (err) {
    const msg = err.toString().indexOf('Action not allowed') !== -1
      ? 'no tengo permiso para agregar invitados a este calendario.'
      : err.toString();
    return { ok: false, error: msg };
  }
}

/** NUEVO — cancela (borra) el evento real de Calendar detrás de una sesión de
 *  tipo CITA. No borra la fila de Sesiones — el estado se marca aparte con
 *  updateSesionEstado(), para conservar el historial en vez de perderlo. */
function cancelarCitaEnCalendar(sesion) {
  if (sesion.tipo !== 'CITA') {
    return { ok: false, error: 'esa sesión es una TAREA, no una cita — usa el comando de eliminar tarea.' };
  }
  try {
    const cal = CalendarApp.getCalendarById(sesion.cal_o_lista_id);
    if (!cal) return { ok: false, error: `no encontré el calendario de esa cita (${sesion.cal_o_lista_id}).` };
    const event = cal.getEventById(sesion.event_id);
    if (!event) return { ok: false, error: 'no encontré el evento en el calendario (¿ya se había borrado?).' };
    event.deleteEvent();
    return { ok: true };
  } catch (err) {
    const msg = err.toString().indexOf('Action not allowed') !== -1
      ? 'no tengo permiso para borrar eventos de este calendario.'
      : err.toString();
    return { ok: false, error: msg };
  }
}

/** NUEVO — agrega un comentario/nota a la DESCRIPCIÓN del evento real de
 *  Calendar detrás de una sesión de tipo CITA (se agrega, no reemplaza lo
 *  que ya hubiera). Solo aplica a CITA — Google Tasks maneja sus notas
 *  aparte, ver editarNotaTareaPorTitulo() en TasksService.gs. */
function editarComentarioEvento(sesion, comentario) {
  if (sesion.tipo !== 'CITA') {
    return { ok: false, error: 'esa sesión es una TAREA, no una cita — usa el comando de anotar tarea.' };
  }
  try {
    const cal = CalendarApp.getCalendarById(sesion.cal_o_lista_id);
    if (!cal) return { ok: false, error: `no encontré el calendario de esa cita (${sesion.cal_o_lista_id}).` };
    const event = cal.getEventById(sesion.event_id);
    if (!event) return { ok: false, error: 'no encontré el evento en el calendario (¿lo borraste?).' };
    const actual = event.getDescription();
    event.setDescription(actual ? actual + '\n' + comentario : comentario);
    return { ok: true };
  } catch (err) {
    const msg = err.toString().indexOf('Action not allowed') !== -1
      ? 'no tengo permiso para editar este calendario.'
      : err.toString();
    return { ok: false, error: msg };
  }
}

/** Actualiza el estado de una sesión y añade el correo invitado a su registro */
function updateSesionEstado(rowIndex, estado, invitadoEmail) {
  const sheet = getOrCreateSesionesSheet();
  sheet.getRange(rowIndex, 8).setValue(estado); // columna 8 = estado
  if (invitadoEmail) {
    const current = sheet.getRange(rowIndex, 9).getValue(); // columna 9 = invitados
    sheet.getRange(rowIndex, 9).setValue(current ? current + ', ' + invitadoEmail : invitadoEmail);
  }
}

/** NUEVO v3.9: punto de entrada para mensajes de TEXTO — clasifica primero y solo
 *  delega a processTextCommand si es un comando; si describe un compromiso nuevo,
 *  avisa que eso se crea por audio en vez de intentarlo a medias por texto. */
