function sendDailySummary() {
  Object.keys(CONFIG.USUARIOS).forEach(telefono => {
    try {
      const usuario = CONFIG.USUARIOS[telefono];
      const today = new Date();
      const formattedDate = Utilities.formatDate(today, CONFIG.TIMEZONE, "yyyy-MM-dd");

      // 1. Citas del día, del calendario de ESTA persona
      const cal = getCalendarPorNombre(usuario.calendario);
      const events = cal.getEventsForDay(today);
      let citasTxt = "";
      if (events.length > 0) {
        events.forEach(evt => {
          const timeStr = Utilities.formatDate(evt.getStartTime(), CONFIG.TIMEZONE, "HH:mm");
          citasTxt += `  • ${timeStr} - ${evt.getTitle()}\n`;
        });
      } else {
        citasTxt = "  • Sin citas agendadas para hoy.\n";
      }

      // 2. Tareas pendientes, de la lista de ESTA persona
      let tareasTxt = "";
      try {
        const taskListId = getTaskListIdPorNombre(usuario.lista);
        const tasks = Tasks.Tasks.list(taskListId).getItems();
        if (tasks && tasks.length > 0) {
          tasks.forEach(t => {
            if (t.getStatus() !== 'completed') tareasTxt += `  • ${t.getTitle()}\n`;
          });
        }
      } catch (e) {
        tareasTxt = "  • No se pudieron consultar las tareas pendientes.\n";
      }
      if (!tareasTxt) tareasTxt = "  • Sin tareas pendientes.\n";

      // 3. WhatsApp
      const saludoNombre = usuario.nombre ? `, ${usuario.nombre}` : '';
      const summaryMsg = `☀️ *¡Buenos días${saludoNombre}! Resumen de hoy (${formattedDate}):*\n\n📅 *Citas del Día:*\n${citasTxt}\n☑️ *Tareas Pendientes:*\n${tareasTxt}\n\n💡 _Escribe "ayuda" en cualquier momento para ver cómo pedirme cosas por texto o voz._`;
      sendWhatsAppMessage(telefono, summaryMsg);

      // 4. NUEVO v3.13: mismo resumen también por correo, como respaldo del WhatsApp
      if (usuario.correo) {
        const cuerpo = construirCuerpoCorreoResumenDiario(usuario.nombre, formattedDate, citasTxt, tareasTxt);
        enviarCorreo(usuario.correo, `NexusVoice — Resumen de hoy (${formattedDate})`, cuerpo);
      }
    } catch (err) {
      Logger.log("Error generando resumen diario para " + telefono + ": " + err.toString());
    }
  });
}

/** Arma el cuerpo HTML del resumen diario a partir del mismo texto que ya se manda por WhatsApp */

function sendRecordatorioNotasPendientes() {
  Object.keys(CONFIG.USUARIOS).forEach(telefono => {
    try {
      const notas = findNotasPendientes(telefono);
      if (notas.length === 0) return; // nada que avisar

      const resumen = `🌙 *Recordatorio — Notas pendientes de configurar (${notas.length}):*`;
      const detalle = notas.map((n, idx) => {
        const fecha = formatFechaCorta(n.created_at);
        return `Nota ${idx + 1} [${n.id_corto}] - ${fecha} - "${n.transcription}"\n  → descartar / agendar cita / generar tarea`;
      }).join('\n\n');
      const pieAyuda = `\n\n💡 _Escribe "ayuda" para ver ejemplos de cómo resolverlas (ej. "N-003 descartar")._`;
      sendWhatsAppMessage(telefono, `${resumen}\n\n${detalle}${pieAyuda}`);
    } catch (err) {
      Logger.log("Error generando recordatorio de notas pendientes para " + telefono + ": " + err.toString());
    }
  });
}

/**
 * NUEVO v3.8 — reemplaza los 3 triggers fijos de "tip de uso" por algo más ágil:
 * el tip corto solo se manda cuando ALGO SE MALINTERPRETÓ (nota ambigua, cita sin
 * fecha clara, error creando cita/tarea), y como máximo 1 vez por día — para no
 * repetir el mismo mensaje si ya se mandó hoy. La ayuda completa sigue disponible
 * en cualquier momento escribiendo "ayuda".
 */
function shouldSendTipHoy() {
  const props = PropertiesService.getScriptProperties();
  const hoy = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  if (props.getProperty('LAST_TIP_DATE') === hoy) return false;
  props.setProperty('LAST_TIP_DATE', hoy);
  return true;
}

/** Versión corta del tip, para no saturar un mensaje que ya trae un error o duda */
function getTipCorto() {
  return `💡 *Tip:* para que no se malinterprete, prueba con "[calendario], cita [fecha] [hora]: [título]" o "pendientes [lista]: [tarea]". Escribe "ayuda" para ver más ejemplos.`;
}
