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
 * Arma el cuerpo HTML de un correo con citas y tareas juntas (formato combinado,
 * recomendado para no multiplicar notificaciones). Reutilizable para el resumen
 * diario y para "mándame las sesiones de hoy por correo".
 */
function construirCuerpoCorreoPendientes(rows, desde, hasta) {
  const citas = rows.filter(r => r.tipo === 'CITA');
  const tareas = rows.filter(r => r.tipo === 'TAREA');
  const filaHtml = r => {
    const invitadosTxt = r.invitados ? ` <span style="color:#666">· invitados: ${r.invitados}</span>` : '';
    return `<li><b>${r.id_sesion}</b> — ${r.fecha_hora} — ${r.titulo}${invitadosTxt}</li>`;
  };
  const seccionCitas = citas.length
    ? `<h3>📅 Citas</h3><ul>${citas.map(filaHtml).join('')}</ul>`
    : `<h3>📅 Citas</h3><p>Sin citas en este rango.</p>`;
  const seccionTareas = tareas.length
    ? `<h3>☑️ Tareas / pendientes</h3><ul>${tareas.map(filaHtml).join('')}</ul>`
    : `<h3>☑️ Tareas / pendientes</h3><p>Sin tareas en este rango.</p>`;
  const rangoTxt = desde === hasta ? desde : `${desde} a ${hasta}`;
  return `<div style="font-family:Arial,sans-serif;max-width:480px">
    <h2>NexusVoice — Pendientes (${rangoTxt})</h2>
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

/**
 * NUEVO v3.7 — Recordatorio 1x al día (pensado para las 8pm) de las notas de voz
 * que quedaron SIN CONFIGURAR (Notas_Pendientes). Solo manda mensaje si hay algo
 * pendiente, para no llenarte de WhatsApps vacíos cada noche.
 * NUEVO v3.13: también es POR PERSONA — cada quien recibe solo SUS notas.
 * Necesitas crear un Trigger de tiempo apuntando a esta función (ver instrucciones).
 */
