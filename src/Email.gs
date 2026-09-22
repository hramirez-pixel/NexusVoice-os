function enviarCorreo(destinatario, asunto, cuerpoHtml) {
  if (!destinatario) return false;
  try {
    MailApp.sendEmail({
      to: destinatario,
      subject: asunto,
      htmlBody: cuerpoHtml,
      body: cuerpoHtml.replace(/<[^>]+>/g, '') // versión texto plano de respaldo
    });
    return true;
  } catch (err) {
    Logger.log("Error enviando correo a " + destinatario + ": " + err.toString());
    logErrorToDatabase('N/A', "Fallo enviando correo a " + destinatario + ": " + err.toString());
    return false;
  }
}

/**
 * Arma el cuerpo HTML del correo de "mándame mi agenda/pendientes por correo".
 * Recibe las mismas listas ya formateadas (texto plano con emoji) que se mandan
 * por WhatsApp para CONSULTAR_AGENDA/CONSULTAR_PENDIENTES (estado REAL de
 * Calendar + Tasks), no filas de Sesiones — así el correo y el WhatsApp siempre
 * muestran exactamente lo mismo.
 */
function construirCuerpoCorreoAgenda(prefijoAgenda, nombreCalendario, listaEventos, listaTareas, desde, hasta) {
  const seccionCitas = listaEventos.length
    ? `<h3>📅 Citas</h3><ul>${listaEventos.map(e => `<li>${e}</li>`).join('')}</ul>`
    : `<h3>📅 Citas</h3><p>Sin citas en este rango.</p>`;
  const seccionTareas = listaTareas.length
    ? `<h3>☑️ Tareas / pendientes</h3><ul>${listaTareas.map(t => `<li>${t}</li>`).join('')}</ul>`
    : `<h3>☑️ Tareas / pendientes</h3><p>Sin tareas en este rango.</p>`;
  const rangoTxt = desde === hasta ? desde : `${desde} a ${hasta}`;
  return `<div style="font-family:Arial,sans-serif;max-width:480px">
    <h2>NexusVoice — ${prefijoAgenda} ("${nombreCalendario}", ${rangoTxt})</h2>
    ${seccionCitas}
    ${seccionTareas}
  </div>`;
}

/**
 * Outbound WhatsApp Response
 * FIX (causa raíz más probable de "no me manda mensajes de autorespuesta"):
 * la versión anterior mandaba el mensaje con muteHttpExceptions:true y SOLO
 * hacía Logger.log() de la respuesta — un log que nadie revisa. Si el
 * WHATSAPP_TOKEN es el token temporal de 24h (como indica tu propia nota de
 * "Próximos Pasos Técnicos") y ya venció, Meta responde con error 190
 * ("Error validating access token") y el mensaje simplemente nunca llega,
 * sin que tú te enteres por ningún lado. Ahora ese error queda registrado en
 * Auditoria_Logs con el código de error de Meta, para que sea visible sin
 * tener que abrir el editor de Apps Script.
 */

function construirCuerpoCorreoResumenDiario(nombre, fecha, citasTxt, tareasTxt) {
  const saludo = nombre ? `Buenos días, ${nombre}` : 'Buenos días';
  const aLi = txt => txt.trim().split('\n').map(l => `<li>${l.replace('•', '').trim()}</li>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:480px">
    <h2>☀️ ${saludo} — ${fecha}</h2>
    <h3>📅 Citas del día</h3><ul>${aLi(citasTxt)}</ul>
    <h3>☑️ Tareas pendientes</h3><ul>${aLi(tareasTxt)}</ul>
  </div>`;
}

/** NUEVO — respaldo por correo del recordatorio nocturno de notas pendientes de
 *  configurar, mismo patrón que el resumen diario (solo se manda si hay algo). */
function construirCuerpoCorreoNotasPendientes(nombre, notas) {
  const saludo = nombre ? `${nombre}, tienes` : 'Tienes';
  const items = notas.map((n, idx) => {
    const fecha = formatFechaCorta(n.created_at);
    return `<li><b>[${n.id_corto}]</b> ${fecha} — "${n.transcription}"</li>`;
  }).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:480px">
    <h2>🌙 ${saludo} ${notas.length} nota(s) pendiente(s) de configurar</h2>
    <ul>${items}</ul>
    <p style="color:#666">Resuélvelas por WhatsApp, ej. "N-003 descartar" / "N-003 agenda cita el viernes 5pm en trabajo".</p>
  </div>`;
}

/**
 * NUEVO v3.7 — Recordatorio 1x al día (pensado para las 8pm) de las notas de voz
 * que quedaron SIN CONFIGURAR (Notas_Pendientes). Solo manda mensaje si hay algo
 * pendiente, para no llenarte de WhatsApps vacíos cada noche.
 * NUEVO v3.13: también es POR PERSONA — cada quien recibe solo SUS notas.
 * Necesitas crear un Trigger de tiempo apuntando a esta función (ver instrucciones).
 */
