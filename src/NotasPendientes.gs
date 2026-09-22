function logToNotasPendientes(audioId, text, gptAnalysis, senderPhone) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName("Notas_Pendientes");
    if (!sheet) return null;

    const idCorto = generateNextNotaId();
    const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([
      Utilities.getUuid(),
      timestamp,
      audioId,
      text,
      JSON.stringify(gptAnalysis),
      "pendiente_confirmacion",
      false, // soft delete
      "",    // deleted_at
      idCorto, // columna 9: id corto para referenciar la nota por WhatsApp
      senderPhone || '' // NUEVO v3.13: columna 10, dueño de la nota
    ]);
    return idCorto;
  } catch (err) {
    Logger.log("Error guardando en Notas_Pendientes: " + err);
    return null;
  }
}

/** Lee las notas de Notas_Pendientes que siguen sin configurar (no descartadas/resueltas).
 *  NUEVO v3.13: si se pasa senderPhone, solo devuelve las de ese dueño (las notas
 *  viejas sin dueño registrado, de antes de v3.13, siguen visibles para todos). */
function findNotasPendientes(senderPhone) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName("Notas_Pendientes");
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const isDeleted = row[6];
    const status = row[5];
    if (isDeleted === true || isDeleted === 'TRUE') continue;
    if (status !== 'pendiente_confirmacion') continue;
    const rowPhone = row[9] ? row[9].toString().trim() : '';
    if (senderPhone && rowPhone && rowPhone !== senderPhone) continue; // no es tuya
    // FIX: las notas creadas antes de v3.7 no tienen id_corto (columna 9 vacía);
    // se les asigna un identificador de respaldo basado en su fila para no romper nada.
    const idCorto = row[8] ? row[8].toString().trim() : ('FILA-' + (i + 1));
    results.push({ rowIndex: i + 1, created_at: row[1], transcription: row[3], id_corto: idCorto });
  }
  return results;
}

/** Busca una nota pendiente por su id_corto (o su ID de respaldo "FILA-N").
 *  NUEVO v3.13: si se pasa senderPhone y la nota tiene otro dueño registrado, no la devuelve. */
function findNotaByIdCorto(idCorto, senderPhone) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName("Notas_Pendientes");
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  const target = idCorto.toString().trim().toUpperCase();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const storedId = row[8] ? row[8].toString().trim().toUpperCase() : ('FILA-' + (i + 1));
    if (storedId === target) {
      const rowPhone = row[9] ? row[9].toString().trim() : '';
      if (senderPhone && rowPhone && rowPhone !== senderPhone) return null; // pertenece a alguien más
      return { rowIndex: i + 1, created_at: row[1], transcription: row[3], id_corto: row[8] || storedId };
    }
  }
  return null;
}

/** Marca una nota pendiente como resuelta (descartada, o convertida en cita/tarea) */
function marcarNotaResuelta(rowIndex, estado) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName("Notas_Pendientes");
  sheet.getRange(rowIndex, 6).setValue(estado); // columna 6 = status
  sheet.getRange(rowIndex, 7).setValue(true);   // columna 7 = is_deleted (deja de listarse como pendiente)
  sheet.getRange(rowIndex, 8).setValue(Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss")); // columna 8 = deleted_at
}

/** Convierte "YYYY-MM-DD..." a formato corto legible "dd/mmm/aa" en español.
 *  FIX v3.14: normaliza primero por si Sheets convirtió el valor a un Date real
 *  (mismo problema explicado en normalizarValorFecha, arriba en Sesiones). */
function formatFechaCorta(fechaHoraStr) {
  if (!fechaHoraStr) return '';
  const str = normalizarValorFecha(fechaHoraStr);
  const datePart = str.substring(0, 10);
  const parts = datePart.split('-');
  if (parts.length !== 3) return str;
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mesIdx = parseInt(parts[1], 10) - 1;
  const mes = meses[mesIdx] || parts[1];
  return `${parts[2]}/${mes}/${parts[0].substring(2)}`;
}

/**
 * NUEVO v3.7: mensaje de ayuda con el formato sugerido para hablarle al bot.
 * No es obligatorio (el GPT sigue entendiendo lenguaje natural), pero ayuda a que
 * el destino (calendario/lista) se identifique sin ambigüedad.
 */
