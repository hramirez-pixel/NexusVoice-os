function parseFechaHora(fechaHoraStr) {
  if (!fechaHoraStr) return null;
  const str = fechaHoraStr.toString().trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (!match) return null;

  const [, y, mo, d, h, mi] = match;
  const hasTime = h !== undefined;
  const date = new Date(
    parseInt(y, 10),
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    hasTime ? parseInt(h, 10) : 0,
    hasTime ? parseInt(mi, 10) : 0
  );
  return { date, hasTime };
}

/** Google Calendar Event Creator */
function createCalendarEvent(title, dateTimeString, calendarId) {
  try {
    // FIX v3.6 (regresión introducida en el ajuste anterior): CalendarApp.getCalendarById()
    // NO reconoce el string literal "primary" (eso solo existe en la REST API de Calendar,
    // no en el servicio CalendarApp de Apps Script). El código anterior a esta versión ya
    // tenía un `|| CalendarApp.getDefaultCalendar()` como salvavidas para ese caso — al
    // quitarlo, TODA cita que cayera al calendario por defecto (sin catálogo específico)
    // empezó a fallar con "el calendario primary no existe". Ahora "primary"/"@default" se
    // resuelve explícitamente con getDefaultCalendar(), y solo los IDs reales del catálogo
    // pasan por getCalendarById() (que si es el punto correcto para detectar un ID inválido).
    let cal;
    let targetCalId;
    if (!calendarId || calendarId === '@default' || calendarId === 'primary') {
      cal = CalendarApp.getDefaultCalendar();
      targetCalId = cal.getId();
    } else {
      targetCalId = calendarId;
      cal = CalendarApp.getCalendarById(targetCalId);
      if (!cal) {
        return { id: null, error: `el calendario "${targetCalId}" no existe o esta cuenta no tiene acceso a él. Revisa el calendar_id en Catalogo_Listas.` };
      }
    }

    const parsed = parseFechaHora(dateTimeString); // FIX: parseo manual, ver parseFechaHora()
    if (!parsed) {
      return { id: null, error: `formato de fecha "${dateTimeString}" no reconocido` };
    }

    let event;
    try {
      if (parsed.hasTime) {
        const endTime = new Date(parsed.date.getTime() + (60 * 60 * 1000));
        event = cal.createEvent(title, parsed.date, endTime);
      } else {
        // FIX: una fecha sin hora ahora crea un evento de TODO EL DÍA en vez de
        // uno con hora falsa a medianoche UTC.
        event = cal.createAllDayEvent(title, parsed.date);
      }
    } catch (createErr) {
      // FIX: "Exception: Action not allowed" significa que el calendario SÍ existe
      // y es legible, pero la cuenta dueña del script no tiene permiso de "Hacer
      // cambios en los eventos" sobre él (solo lectura, o compartido desde otra
      // cuenta con permisos limitados). Se distingue explícitamente de "no existe".
      if (createErr.toString().indexOf('Action not allowed') !== -1) {
        return { id: null, error: `no tienes permiso de EDICIÓN sobre el calendario "${targetCalId}" (solo lectura). Revisa "Configuración y uso compartido" de ese calendario en Google Calendar y otorga permiso de "Hacer cambios en los eventos" a esta cuenta.` };
      }
      throw createErr;
    }
    return { id: event.getId(), allDay: !parsed.hasTime, calendarId: targetCalId }; // FIX: se devuelve el ID real usado, necesario para poder agregar invitados después
  } catch (error) {
    Logger.log("Error creando evento en Calendar: " + error.toString());
    return { id: null, error: error.toString() };
  }
}

/** Google Tasks Creator */
