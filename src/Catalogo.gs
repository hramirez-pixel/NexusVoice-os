function getTargetListId(targetName, type) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName("Catalogo_Listas");
    if (sheet && targetName) {
      const data = sheet.getDataRange().getValues();
      const cleanTarget = targetName.toString().toLowerCase().trim();

      let exactMatch = null;
      let prefixMatch = null;
      let partialMatch = null;

      for (let i = 1; i < data.length; i++) {
        const rawName = data[i][0] ? data[i][0].toString().trim() : "";
        if (!rawName) continue; // FIX: ignora filas vacías por completo

        const listNameInSheet = rawName.toLowerCase();
        const val = type === 'CALENDAR' ? data[i][2] : data[i][1];

        if (listNameInSheet === cleanTarget) {
          exactMatch = val;
          break; // una coincidencia exacta gana siempre, no hace falta seguir buscando
        }
        if (!prefixMatch && (listNameInSheet.startsWith(cleanTarget) || cleanTarget.startsWith(listNameInSheet))) {
          prefixMatch = val;
        }
        if (!partialMatch && (listNameInSheet.includes(cleanTarget) || cleanTarget.includes(listNameInSheet))) {
          partialMatch = val;
        }
      }

      const chosen = exactMatch !== null ? exactMatch : (prefixMatch !== null ? prefixMatch : partialMatch);
      if (chosen !== null && chosen !== undefined && chosen !== "") {
        if (type === 'CALENDAR' && chosen.toString().toLowerCase() === 'primary') return 'primary';
        return chosen;
      }
    }
  } catch (err) {
    Logger.log("Error consultando catálogo: " + err);
  }
  return type === 'CALENDAR' ? 'primary' : '@default';
}

/** NUEVO v3.13: resuelve un nombre de calendario (ej. "Personales", "Ella-Personal")
 *  al objeto Calendar real, reutilizando la misma lógica segura de primary/@default
 *  que ya usa createCalendarEvent (evita repetir ese bug ya corregido en otro lado). */
function getCalendarPorNombre(nombreDestino) {
  const calId = getTargetListId(nombreDestino, 'CALENDAR');
  if (!calId || calId === '@default' || calId === 'primary') {
    return CalendarApp.getDefaultCalendar();
  }
  const cal = CalendarApp.getCalendarById(calId);
  return cal || CalendarApp.getDefaultCalendar();
}

/** NUEVO v3.13: resuelve un nombre de lista (ej. "Personales", "Ella") al ID real de
 *  Google Tasks, reutilizando getTargetListId + getTaskListIdByName. */
function getTaskListIdPorNombre(nombreDestino) {
  const listName = getTargetListId(nombreDestino, 'TASK');
  return getTaskListIdByName(listName);
}

/**
 * Convierte "YYYY-MM-DD HH:mm" o "YYYY-MM-DD" a un objeto Date, construyendo
 * los componentes a mano (año, mes, día, hora, minuto) en vez de dejar que el
 * parser nativo de Date() interprete el string.
 *
 * FIX (bug raíz de "las citas no se generan bien"):
 *  - `new Date("2026-09-20")` (solo fecha) se interpreta según el estándar ISO-8601
 *    como MEDIANOCHE EN UTC, no en America/Cancun. Con UTC-5, eso cae el día anterior
 *    a las 7pm — la cita aparecía un día antes o a una hora rara.
 *  - `new Date("2026-09-20 14:00")` (con espacio en vez de "T") depende del motor
 *    de JavaScript y de la zona horaria del PROYECTO de Apps Script (que puede no
 *    coincidir con CONFIG.TIMEZONE = America/Cancun), dando horas desplazadas.
 * Construir el Date con el constructor de componentes (year, month, day, hour, min)
 * evita ambos problemas: Apps Script siempre interpreta esos componentes en la zona
 * horaria del proyecto, de forma predecible.
 */
