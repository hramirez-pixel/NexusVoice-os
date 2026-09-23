function processIncomingAudio(audioId, senderPhone) {
  try {
    const openAiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    const waToken = PropertiesService.getScriptProperties().getProperty('WHATSAPP_TOKEN');

    // 1. Descarga y Transcripción
    const audioBlob = fetchWhatsAppAudioBlob(audioId, waToken);
    const transcriptionText = transcribeAudioWithWhisper(audioBlob, openAiKey);

    // NUEVO v3.9: un solo clasificador decide si es una NOTA nueva (cita/tarea) o un
    // COMANDO sobre algo que ya existe — evita que un mensaje mixto ("cita jueves 6pm,
    // agrega a fulano@x.com") se interprete a medias por dos clasificadores distintos.
    const clasif = classifyIncomingMessage(transcriptionText, openAiKey);

    if (clasif.modo === 'COMANDO') {
      processTextCommand(transcriptionText, senderPhone, clasif);
      logComandoToDatabase(audioId, transcriptionText, clasif.intent);
      return;
    }

    // 2. modo === 'NOTA': analysis trae es_ambiguo/mensaje_duda/acciones directamente
    const analysis = clasif;

    // 3. Evaluar Ambigüedad -> Si hay duda, enviar a 'Notas_Pendientes'
    if (analysis.es_ambiguo) {
      const idNota = logToNotasPendientes(audioId, transcriptionText, analysis, senderPhone);
      logToDatabase(audioId, transcriptionText, analysis, "PENDIENTE_CONFIRMACION");

      const idTxt = idNota ? ` [${idNota}]` : '';
      let dudaMsg = `❓ *NexusVoice OS - Confirmación requerida${idTxt}:*\n\n"${transcriptionText}"\n\n${analysis.mensaje_duda || 'No pude determinar el destino de tu solicitud. Se guardó en Notas_Pendientes.'}\n\nCuando quieras, escríbeme "notas pendientes de configurar" para revisarla junto con las demás.`;
      if (shouldSendTipHoy()) dudaMsg += `\n\n${getTipCorto()}`; // NUEVO v3.8: tip solo cuando algo se malinterpretó, máx. 1x/día
      sendWhatsAppMessage(senderPhone, dudaMsg);
      return;
    }

    let actionsCreated = [];
    let actionIds = [];
    let actionErrors = []; // FIX: antes los fallos de una acción individual eran completamente invisibles
    const usuario = getUsuario(senderPhone); // NUEVO v3.13: perfil del remitente, para el destino por defecto

    // 4. Procesar Lista de Acciones
    if (analysis.acciones && analysis.acciones.length > 0) {
      analysis.acciones.forEach(acc => {
        // NUEVO v3.13: antes el default era siempre "Personales" para cualquiera;
        // ahora cada remitente tiene su propio calendario/lista por defecto.
        // NUEVO v3.14: para CITA, "trabajo"/"personal" dichos se resuelven al
        // calendario propio de ESTE remitente (ver resolverDestinoCalendario).
        const targetAlias = acc.tipo === 'CITA'
          ? resolverDestinoCalendario(acc.destino, usuario)
          : (acc.destino || usuario.lista);

        if (acc.tipo === 'CITA') {
          // FIX: antes, una CITA sin fecha_hora se descartaba en silencio (ni se creaba,
          // ni se avisaba, ni quedaba registro). Ahora, si falta la fecha, se manda a
          // Notas_Pendientes igual que una nota ambigua, en vez de desaparecer.
          if (!acc.fecha_hora) {
            const idNota = logToNotasPendientes(audioId, transcriptionText, analysis, senderPhone);
            const idTxt = idNota ? ` [${idNota}]` : '';
            actionErrors.push(`❓ *Cita sin fecha clara:* "${acc.titulo}"${idTxt} — se guardó en Notas_Pendientes para que la confirmes (escribe "notas pendientes de configurar" para verla).`);
            return;
          }
          const calId = getTargetListId(targetAlias, 'CALENDAR');
          const result = createCalendarEvent(acc.titulo, acc.fecha_hora, calId);
          if (result.id) {
            actionIds.push(`CAL:${result.id}`);
            // NUEVO v3.6: cada cita recibe un ID corto y queda registrada en "Sesiones"
            // para poder agregarle invitados después, y para consultarla en "pendientes".
            const sesionInfo = logSesion('CITA', result.id, result.calendarId, acc.titulo, acc.fecha_hora, senderPhone);
            const idSesion = sesionInfo ? sesionInfo.idSesion : null;
            if (idSesion) recordLastSesion(senderPhone, idSesion);

            // NUEVO v3.9: si en el MISMO audio se pidió agregar invitados a esta cita
            // (ej. "cita el jueves... agrega a fulano@x.com"), se agregan de una vez
            // en vez de perderse o convertirse en una tarea aparte.
            let invitadosAgregados = [];
            let invitadosInvalidos = [];
            if (acc.invitados && acc.invitados.length > 0) {
              acc.invitados.forEach(correoRaw => {
                const correo = normalizarCorreoHablado(correoRaw); // FIX v3.11: convierte "arroba"/"punto" dictados a @/.
                if (!esCorreoValido(correo)) {
                  invitadosInvalidos.push(correoRaw);
                  return;
                }
                const inviteResult = addGuestToSesion({ tipo: 'CITA', event_id: result.id, cal_o_lista_id: result.calendarId }, correo);
                if (inviteResult.ok) {
                  invitadosAgregados.push(correo);
                } else {
                  invitadosInvalidos.push(`${correo} (${inviteResult.error})`);
                }
              });
              if (invitadosAgregados.length > 0 && sesionInfo) {
                updateSesionEstado(sesionInfo.rowIndex, 'invitado_agregado', invitadosAgregados.join(', '));
              }
            }

            const idTxt = idSesion ? ` [${idSesion}]` : '';
            // FIX v3.7/v3.9: leyenda más explícita, y distinta según si ya se agregó
            // un invitado desde el mismo audio o si aún se puede agregar.
            let inviteTxt = '';
            if (idSesion) {
              inviteTxt = invitadosAgregados.length > 0
                ? `\n\n✅ Se ha generado la sesión con *${idSesion}* y ya agregué a ${invitadosAgregados.join(', ')}. ¿Alguien más? Contesta "agrega a correo@ejemplo.com" (${CONFIG.INVITE_WINDOW_MINUTES} min) o "${idSesion} agrega a correo@ejemplo.com" cuando quieras.`
                : `\n\n✅ Se ha generado la sesión con *${idSesion}*. Puedes agregar correos para que les llegue la notificación de esta cita — contesta "agrega a correo@ejemplo.com" ahora (${CONFIG.INVITE_WINDOW_MINUTES} min) o "${idSesion} agrega a correo@ejemplo.com" cuando quieras.`;
              if (invitadosInvalidos.length > 0) {
                inviteTxt += `\n\n⚠️ Detecté que querías agregar a alguien pero no reconocí un correo válido ("${invitadosInvalidos.join('", "')}") — el dictado de voz a veces pierde la @. Respóndeme con "${idSesion} agrega a correo@dominio.com".`;
              }
            }
            actionsCreated.push(`📅 *Cita:* ${acc.titulo}${idTxt}\n  • *Fecha:* ${acc.fecha_hora}${result.allDay ? ' (todo el día)' : ''}\n  • *Calendario:* [${targetAlias}]${inviteTxt}`);
          } else {
            // FIX: antes un error aquí (calendario inválido, permisos, etc.) se perdía en Logger.log
            actionErrors.push(`⚠️ No pude crear la cita "${acc.titulo}": ${result.error}`);
          }
        } else if (acc.tipo === 'TAREA') {
          const taskListName = getTargetListId(targetAlias, 'TASK');
          const realTaskListId = getTaskListIdByName(taskListName);
          const result = createGoogleTask(acc.titulo, acc.fecha_hora, realTaskListId);
          if (result.id) {
            actionIds.push(`TASK:${result.id}`);
            const sesionInfo = logSesion('TAREA', result.id, realTaskListId, acc.titulo, acc.fecha_hora, senderPhone);
            const idSesion = sesionInfo ? sesionInfo.idSesion : null;
            const idTxt = idSesion ? ` [${idSesion}]` : '';
            actionsCreated.push(`☑️ *Tarea:* ${acc.titulo}${idTxt}\n  • *Lista:* [${targetAlias}]${acc.fecha_hora ? '\n  • *Vence:* ' + acc.fecha_hora : ''}`);
          } else {
            actionErrors.push(`⚠️ No pude crear la tarea "${acc.titulo}": ${result.error}`);
          }
        }
      });
    }

    // 5. Generar Mensaje de Confirmación (ahora incluye errores parciales, no solo éxitos)
    let parts = [];
    if (actionsCreated.length > 0) {
      parts.push(`✅ *Procesado con éxito:*\n\n` + actionsCreated.join('\n\n'));
    }
    if (actionErrors.length > 0) {
      parts.push(actionErrors.join('\n\n'));
      if (shouldSendTipHoy()) parts.push(getTipCorto()); // NUEVO v3.8: tip solo cuando algo se malinterpretó, máx. 1x/día
    }
    let confirmationMsg = parts.length > 0 ? parts.join('\n\n---\n\n') : `📝 *Nota guardada:* "${transcriptionText}"`;

    // 6. Registro BD y Respuesta de vuelta al número del remitente
    logToDatabase(audioId, transcriptionText, analysis, actionIds.join(', '));
    sendWhatsAppMessage(senderPhone, confirmationMsg);

  } catch (err) {
    logErrorToDatabase(audioId, err.toString());
    // FIX: antes, si todo el pipeline fallaba (ej. transcripción o clasificación),
    // el usuario nunca se enteraba — el audio se "perdía" sin ningún aviso.
    // Ahora, si tenemos el teléfono, se lo notificamos aunque el resto haya fallado.
    try {
      sendWhatsAppMessage(senderPhone, `⚠️ Tuve un problema procesando tu nota de voz. Ya quedó registrado el error para revisarlo. (${err.toString().substring(0, 120)})`);
    } catch (notifyErr) {
      Logger.log("No se pudo notificar el error al usuario: " + notifyErr);
    }
  }
}

/**
 * GPT: clasifica CUALQUIER mensaje entrante (audio transcrito o texto) en un solo paso.
 * FIX v3.9: antes había dos clasificadores separados (uno para "nota nueva" y otro para
 * "comando"), y un mensaje como "cita el jueves 6pm, agrega a fulano@x.com" podía disparar
 * los dos a la vez — la cita nunca se creaba porque el comando de invitado se procesaba
 * primero y no encontraba ninguna sesión previa. Ahora un único clasificador decide
 * PRIMERO si el mensaje es una nota nueva (modo NOTA) o una acción sobre algo que ya
 * existe (modo COMANDO), y solo entonces extrae los campos correspondientes.
 */

/**
 * FIX v3.10: construye una tabla de los próximos N días con su fecha exacta y nombre
 * de día, calculada 100% en código (nunca puede fallar), para que el modelo NUNCA tenga
 * que sumar/restar días de la semana por su cuenta — solo busca el nombre en la tabla.
 * Antes se le pedía calcular "próximo jueves" a partir de "hoy es domingo", y los modelos
 * (incluso a temperature 0) fallan justo en ese tipo de aritmética de calendario —
 * por eso "el próximo jueves" y "el próximo lunes" llegaban a fechas equivocadas.
 */

function handleTextMessage(text, senderPhone) {
  try {
    const openAiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    const clasif = classifyIncomingMessage(text, openAiKey);
    if (clasif.modo === 'NOTA') {
      sendWhatsAppMessage(senderPhone, '🎙️ Para crear una cita o tarea nueva, mándamela por nota de voz. Por texto puedo agregar invitados, mostrarte pendientes, o resolver notas — escribe "ayuda" para ver cómo.');
      return;
    }
    processTextCommand(text, senderPhone, clasif);
  } catch (err) {
    Logger.log('Error procesando mensaje de texto: ' + err);
    logErrorToDatabase('N/A', 'Error en handleTextMessage: ' + err.toString());
    sendWhatsAppMessage(senderPhone, '⚠️ Tuve un problema procesando tu mensaje.');
  }
}

/** Procesa un mensaje de texto (o audio ya transcrito) entrante: agregar invitado,
 *  consultar pendientes, notas por configurar, ayuda, etc.
 *  cmdPrecalculado: si ya se clasificó antes (ej. desde processIncomingAudio o
 *  handleTextMessage, para evitar llamar dos veces a GPT), se pasa aquí. */
function processTextCommand(text, senderPhone, cmdPrecalculado) {
  try {
    const openAiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    const cmd = cmdPrecalculado || classifyIncomingMessage(text, openAiKey);

    if (cmd.intent === 'AGREGAR_INVITADO') {
      if (!cmd.email) {
        sendWhatsAppMessage(senderPhone, '¿A qué correo quieres agregar? Mándame algo como "ID-003 agrega a juan@correo.com".');
        return;
      }
      const correoNormalizado = normalizarCorreoHablado(cmd.email); // FIX v3.11: por si lo escribió/dictó con "arroba"/"punto"
      if (!esCorreoValido(correoNormalizado)) {
        sendWhatsAppMessage(senderPhone, `No reconocí "${cmd.email}" como un correo válido. Mándamelo de nuevo con el símbolo @, ej. "ID-003 agrega a juan@correo.com".`);
        return;
      }

      let sesion = null;
      if (cmd.id_sesion) {
        sesion = findSesionById(cmd.id_sesion, senderPhone);
        if (!sesion) {
          sendWhatsAppMessage(senderPhone, `No encontré ninguna sesión con el ID "${cmd.id_sesion}".`);
          return;
        }
      } else if (cmd.fecha_hora_referencia) {
        const matches = findSesionesByFecha(cmd.fecha_hora_referencia, cmd.titulo_referencia, senderPhone);
        if (matches.length === 0) {
          sendWhatsAppMessage(senderPhone, `No encontré ninguna cita/tarea el ${cmd.fecha_hora_referencia}. Dame el ID si lo tienes.`);
          return;
        } else if (matches.length > 1) {
          const lista = matches.map(m => `🆔 ${m.id_sesion} - ${m.titulo} (${m.fecha_hora})`).join('\n');
          sendWhatsAppMessage(senderPhone, `Encontré varias coincidencias, dime el ID exacto:\n\n${lista}`);
          return;
        }
        sesion = matches[0];
      } else {
        // Ventana de contexto: permite "agrega a fulano@x.com" sin ID justo después de la cita
        const lastRaw = PropertiesService.getScriptProperties().getProperty('LAST_SESION_' + senderPhone);
        if (lastRaw) {
          const last = JSON.parse(lastRaw);
          if ((Date.now() - last.ts) / 60000 <= CONFIG.INVITE_WINDOW_MINUTES) {
            sesion = findSesionById(last.id, senderPhone);
          }
        }
        if (!sesion) {
          sendWhatsAppMessage(senderPhone, `Ya pasó el tiempo de espera de la última cita (o no hay ninguna reciente). Dame el ID de la sesión (ej. "ID-003") o la fecha/hora de la cita para agregar el correo.`);
          return;
        }
      }

      const result = addGuestToSesion(sesion, correoNormalizado);
      if (result.ok) {
        updateSesionEstado(sesion.rowIndex, 'invitado_agregado', correoNormalizado);
        sendWhatsAppMessage(senderPhone, `✅ Agregué a ${correoNormalizado} a "${sesion.titulo}" [${sesion.id_sesion}].`);
      } else {
        sendWhatsAppMessage(senderPhone, `⚠️ No pude agregar a ${correoNormalizado} a [${sesion.id_sesion}]: ${result.error}`);
      }
      return;
    }

    // NUEVO: marcar una o varias tareas reales de Google Tasks como completadas
    // por título aproximado (no hay ID corto para tareas como sí lo hay para
    // Sesiones/citas), dejando una nota si el usuario mencionó alguna. Soporta
    // agenda compartida (destino_agenda/persona_agenda) igual que CONSULTAR_AGENDA.
    if (cmd.intent === 'COMPLETAR_TAREA') {
      const titulosTarea = Array.isArray(cmd.titulos_tarea) ? cmd.titulos_tarea.filter(Boolean) : [];
      if (titulosTarea.length === 0) {
        sendWhatsAppMessage(senderPhone, 'Dime qué tarea(s) marco como hechas, ej. "ya hice lo de enviar reportes".');
        return;
      }

      let usuarioTarea = getUsuario(senderPhone);
      let personaMencionada = cmd.persona_agenda;
      let destinoParaResolver = cmd.destino_agenda;
      if (!personaMencionada && destinoParaResolver && getUsuarioPorNombre(destinoParaResolver)) {
        personaMencionada = destinoParaResolver;
        destinoParaResolver = null;
      }
      if (personaMencionada) {
        const otroUsuario = getUsuarioPorNombre(personaMencionada);
        if (!otroUsuario) {
          sendWhatsAppMessage(senderPhone, `No reconozco a "${personaMencionada}". Solo puedo marcar tareas de: ${getNombresRegistrados().join(', ')}.`);
          return;
        }
        usuarioTarea = otroUsuario;
      }

      const destinoResueltoTarea = resolverDestinoCalendario(destinoParaResolver, usuarioTarea);
      const taskListIdTarea = getTaskListIdPorNombre(destinoResueltoTarea);
      const resultados = titulosTarea.map(titulo => completarTareaPorTitulo(taskListIdTarea, titulo, cmd.nota_tarea));

      const exitosas = resultados.filter(r => !r.error);
      const fallidas = resultados.filter(r => r.error);
      const partes = [];
      if (exitosas.length) partes.push(exitosas.map(r => `✅ "${r.titulo}" marcada como completada.`).join('\n'));
      if (fallidas.length) partes.push(fallidas.map(r => `⚠️ ${r.error}`).join('\n\n'));
      if (cmd.nota_tarea && exitosas.length) partes.push(`📝 Nota aplicada: ${cmd.nota_tarea}`);
      sendWhatsAppMessage(senderPhone, partes.join('\n\n'));
      return;
    }

    // UNIFICADO: "pendientes" y "agenda" son la MISMA consulta — el estado REAL de
    // Calendar + Tasks (no solo lo que este bot creó; antes CONSULTAR_PENDIENTES solo
    // leía el registro interno en Sesiones, y por eso no veía nada creado directo en
    // Google Tasks/Calendar). Solo cambia la palabra que dispara cada intent.
    // Soporta agenda compartida: si se menciona una persona registrada, consulta SU
    // calendario/lista en vez de la propia (ej. "qué tiene Angy hoy", "pendientes de Angy").
    if (cmd.intent === 'CONSULTAR_AGENDA' || cmd.intent === 'CONSULTAR_PENDIENTES') {
      const hoyAgenda = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
      const desdeAgenda = cmd.rango_desde || hoyAgenda;
      const hastaAgenda = cmd.rango_hasta || desdeAgenda;

      let usuarioAgenda = getUsuario(senderPhone);
      let prefijoAgenda = 'Tu agenda';
      let personaMencionada = cmd.persona_agenda;
      let destinoParaResolver = cmd.destino_agenda;
      // FIX: red de seguridad — a veces el clasificador pone el nombre de la persona
      // en "destino_agenda" en vez de "persona_agenda" (son fáciles de confundir). Si
      // "destino_agenda" coincide con un nombre registrado, se trata como persona, no
      // como alias de calendario.
      if (!personaMencionada && destinoParaResolver && getUsuarioPorNombre(destinoParaResolver)) {
        personaMencionada = destinoParaResolver;
        destinoParaResolver = null;
      }
      if (personaMencionada) {
        const otroUsuario = getUsuarioPorNombre(personaMencionada);
        if (!otroUsuario) {
          sendWhatsAppMessage(senderPhone, `No reconozco a "${personaMencionada}". Solo puedo ver la agenda de: ${getNombresRegistrados().join(', ')}.`);
          return;
        }
        usuarioAgenda = otroUsuario;
        prefijoAgenda = `La agenda de ${otroUsuario.nombre}`;
      }

      const destinoResuelto = resolverDestinoCalendario(destinoParaResolver, usuarioAgenda);
      const calAgenda = getCalendarPorNombre(destinoResuelto);
      const eventosAgenda = getEventosEnRango(calAgenda, desdeAgenda, hastaAgenda);

      // NUEVO: tareas con vencimiento en el mismo rango, de la lista de Tasks de la
      // misma persona/destino — así "qué tenía ayer" también trae pendientes vencidos.
      const taskListIdAgenda = getTaskListIdPorNombre(destinoResuelto);
      const tareasAgenda = getTareasEnRango(taskListIdAgenda, desdeAgenda, hastaAgenda);
      const listaTareas = tareasAgenda.map(t => {
        const dueStr = t.getDue() ? Utilities.formatDate(new Date(t.getDue()), CONFIG.TIMEZONE, "yyyy-MM-dd") : null;
        const vencida = dueStr && dueStr < hoyAgenda;
        return `☑️ ${vencida ? 'Vencida' : 'Pendiente'}: ${t.getTitle()}`;
      });

      if (eventosAgenda.length === 0 && listaTareas.length === 0) {
        sendWhatsAppMessage(senderPhone, `${prefijoAgenda} ("${calAgenda.getName()}") no tiene nada entre ${desdeAgenda} y ${hastaAgenda}.`);
        return;
      }
      const listaEventos = eventosAgenda.map(evt => {
        const inicioTxt = evt.isAllDayEvent()
          ? Utilities.formatDate(evt.getAllDayStartDate(), CONFIG.TIMEZONE, "yyyy-MM-dd") + ' (todo el día)'
          : Utilities.formatDate(evt.getStartTime(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm");
        return `📅 ${inicioTxt} - ${evt.getTitle()}`;
      });
      const cuerpoAgenda = listaEventos.concat(listaTareas).join('\n');
      sendWhatsAppMessage(senderPhone, `🗓️ *${prefijoAgenda} ("${calAgenda.getName()}", ${desdeAgenda} a ${hastaAgenda}):*\n\n${cuerpoAgenda}`);

      // Si además pidió que se lo mandaran por correo ("mándame lo de hoy por correo"),
      // se envía SIEMPRE al correo de quien pregunta (no al de la persona consultada).
      if (cmd.porCorreo) {
        const usuarioSolicitante = getUsuario(senderPhone);
        if (!usuarioSolicitante.correo) {
          sendWhatsAppMessage(senderPhone, '⚠️ No tengo un correo configurado para ti todavía — pide que lo agreguen en CONFIG.USUARIOS.');
        } else {
          const asunto = `NexusVoice — ${prefijoAgenda} (${desdeAgenda} a ${hastaAgenda})`;
          const cuerpoCorreo = construirCuerpoCorreoAgenda(prefijoAgenda, calAgenda.getName(), listaEventos, listaTareas, desdeAgenda, hastaAgenda);
          const enviado = enviarCorreo(usuarioSolicitante.correo, asunto, cuerpoCorreo);
          sendWhatsAppMessage(senderPhone, enviado ? `📧 Te lo mandé también a ${usuarioSolicitante.correo}.` : '⚠️ No pude mandar el correo, revisa Auditoria_Logs.');
        }
      }
      return;
    }

    // NUEVO v3.7: listar notas de voz que no se pudieron clasificar solas
    if (cmd.intent === 'CONSULTAR_NOTAS_PENDIENTES') {
      const notas = findNotasPendientes(senderPhone);
      if (notas.length === 0) {
        sendWhatsAppMessage(senderPhone, '✅ No tienes notas pendientes de configurar.');
        return;
      }
      const resumen = `📋 *Notas pendientes de configurar (${notas.length}):*`;
      const detalle = notas.map((n, idx) => {
        const fecha = formatFechaCorta(n.created_at);
        return `Nota ${idx + 1} [${n.id_corto}] - ${fecha} - "${n.transcription}"\n  → descartar / agendar cita / generar tarea (ej. "${n.id_corto} descartar", "${n.id_corto} agenda cita el viernes 5pm en trabajo")`;
      }).join('\n\n');
      sendWhatsAppMessage(senderPhone, `${resumen}\n\n${detalle}`);
      return;
    }

    // NUEVO v3.7: resolver una nota pendiente (descartar, agendar cita, o generar tarea)
    if (cmd.intent === 'RESOLVER_NOTA_PENDIENTE') {
      if (!cmd.nota_id) {
        sendWhatsAppMessage(senderPhone, 'Dime el ID de la nota (ej. "N-003") y qué quieres hacer: descartar, agendar cita o generar tarea.');
        return;
      }
      const nota = findNotaByIdCorto(cmd.nota_id, senderPhone);
      // NUEVO v3.9: descartar TODAS las notas pendientes de una vez ("descarta todas las notas")
      if (!nota && cmd.nota_id.toString().trim().toUpperCase() === 'TODAS') {
        if (cmd.accion_nota !== 'DESCARTAR') {
          sendWhatsAppMessage(senderPhone, 'Por ahora, "todas" solo funciona para descartar ("descarta todas las notas pendientes"). Para agendar o generar tarea, hazlo nota por nota con su ID.');
          return;
        }
        const notas = findNotasPendientes(senderPhone);
        if (notas.length === 0) {
          sendWhatsAppMessage(senderPhone, '✅ No tienes notas pendientes que descartar.');
          return;
        }
        notas.forEach(n => marcarNotaResuelta(n.rowIndex, 'descartada'));
        sendWhatsAppMessage(senderPhone, `🗑️ Descarté las ${notas.length} notas pendientes de configurar.`);
        return;
      }
      if (!nota) {
        sendWhatsAppMessage(senderPhone, `No encontré ninguna nota pendiente con el ID "${cmd.nota_id}".`);
        return;
      }

      if (cmd.accion_nota === 'DESCARTAR') {
        marcarNotaResuelta(nota.rowIndex, 'descartada');
        sendWhatsAppMessage(senderPhone, `🗑️ Descarté la nota [${nota.id_corto}].`);
        return;
      }

      if (cmd.accion_nota === 'AGENDAR_CITA' || cmd.accion_nota === 'GENERAR_TAREA') {
        if (!cmd.fecha_hora_nueva) {
          const ejemploAccion = cmd.accion_nota === 'AGENDAR_CITA' ? 'agenda cita' : 'genera tarea';
          sendWhatsAppMessage(senderPhone, `¿Para qué fecha/hora? Dime algo como "${nota.id_corto} ${ejemploAccion} el viernes a las 10am en trabajo".`);
          return;
        }
        // NUEVO v3.13: usa el calendario/lista por defecto del remitente, no un "Personales" genérico
        const usuarioNota = getUsuario(senderPhone);
        // NUEVO v3.14: mismo alias trabajo/personal que en las citas creadas por audio
        const destinoAlias = cmd.accion_nota === 'AGENDAR_CITA'
          ? resolverDestinoCalendario(cmd.destino_nuevo, usuarioNota)
          : (cmd.destino_nuevo || usuarioNota.lista);

        if (cmd.accion_nota === 'AGENDAR_CITA') {
          const calId = getTargetListId(destinoAlias, 'CALENDAR');
          const result = createCalendarEvent(nota.transcription, cmd.fecha_hora_nueva, calId);
          if (result.id) {
            const sesionInfo = logSesion('CITA', result.id, result.calendarId, nota.transcription, cmd.fecha_hora_nueva, senderPhone);
            const idSesion = sesionInfo ? sesionInfo.idSesion : null;
            if (idSesion) recordLastSesion(senderPhone, idSesion);
            marcarNotaResuelta(nota.rowIndex, 'resuelta_cita:' + idSesion);
            sendWhatsAppMessage(senderPhone, `✅ Se ha generado la sesión con *${idSesion}* a partir de la nota [${nota.id_corto}]. Puedes agregar correos con "${idSesion} agrega a correo@ejemplo.com".`);
          } else {
            sendWhatsAppMessage(senderPhone, `⚠️ No pude agendar la cita de [${nota.id_corto}]: ${result.error}`);
          }
        } else {
          const taskListName = getTargetListId(destinoAlias, 'TASK');
          const realTaskListId = getTaskListIdByName(taskListName);
          const result = createGoogleTask(nota.transcription, cmd.fecha_hora_nueva, realTaskListId);
          if (result.id) {
            const sesionInfo = logSesion('TAREA', result.id, realTaskListId, nota.transcription, cmd.fecha_hora_nueva, senderPhone);
            const idSesion = sesionInfo ? sesionInfo.idSesion : null;
            marcarNotaResuelta(nota.rowIndex, 'resuelta_tarea:' + idSesion);
            sendWhatsAppMessage(senderPhone, `✅ Se ha generado la tarea con *${idSesion}* a partir de la nota [${nota.id_corto}].`);
          } else {
            sendWhatsAppMessage(senderPhone, `⚠️ No pude generar la tarea de [${nota.id_corto}]: ${result.error}`);
          }
        }
        return;
      }

      sendWhatsAppMessage(senderPhone, `Dime qué quieres hacer con [${nota.id_corto}]: descartar, agendar cita, o generar tarea.`);
      return;
    }

    // NUEVO v3.7: ayuda / formato sugerido, bajo demanda
    if (cmd.intent === 'AYUDA') {
      sendWhatsAppMessage(senderPhone, getMensajeAyuda());
      return;
    }

    // OTRO
    sendWhatsAppMessage(senderPhone, '🎙️ Puedo procesar notas de voz para crear citas/tareas, agregar invitados a una cita, o mostrarte tus pendientes. Escribe "ayuda" para ver ejemplos de cómo pedírmelo.');
  } catch (err) {
    Logger.log('Error procesando comando de texto: ' + err);
    logErrorToDatabase('N/A', 'Error en processTextCommand: ' + err.toString());
    sendWhatsAppMessage(senderPhone, '⚠️ Tuve un problema procesando tu mensaje.');
  }
}

/** Inserción en Notas_Pendientes. NUEVO v3.7: devuelve un id_corto (N-XXX) guardado en
 *  una 9na columna. NUEVO v3.13: 10ma columna con sender_phone, para que cada quien
 *  vea/resuelva solo SUS notas pendientes cuando dos personas comparten el número. */
