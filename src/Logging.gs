function logToDatabase(audioId, text, analysis, actionId) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName("Auditoria_Logs");
  const newId = Utilities.getUuid();
  const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([
    newId,
    timestamp,
    audioId,
    text,
    analysis.es_ambiguo ? "AMBIGUO" : "PROCESADO",
    analysis.es_ambiguo ? "pendiente_revision" : "procesado",
    false, // is_deleted
    ""     // deleted_at
  ]);
}

/** NUEVO v3.9: registra en Auditoria_Logs cuando un audio resultó ser un COMANDO
 *  (agregar invitado, consultar pendientes, etc.) en vez de una nota nueva */
function logComandoToDatabase(audioId, text, intent) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName("Auditoria_Logs");
    const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([Utilities.getUuid(), timestamp, audioId, text, "COMANDO:" + intent, "procesado", false, ""]);
  } catch (err) {
    Logger.log("Error registrando comando en Auditoria_Logs: " + err);
  }
}

/** Error Log */
function logErrorToDatabase(audioId, errorMessage) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName("Auditoria_Logs");
  const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([
    Utilities.getUuid(),
    timestamp,
    audioId,
    "ERROR: " + errorMessage,
    "ERROR",
    "requiere_atencion",
    false,
    ""
  ]);
}

/**
 * NUEVO v3.13 — Canal de notificación por CORREO, como respaldo del WhatsApp
 * (que puede perderse entre muchas notificaciones). Usa MailApp, que manda el
 * correo como la cuenta de Google dueña del script — no requiere ninguna
 * configuración adicional de SMTP ni credenciales extra.
 */
