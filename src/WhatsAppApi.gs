function fetchWhatsAppAudioBlob(mediaId, waToken) {
  const mediaUrlResponse = UrlFetchApp.fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${waToken}` },
    muteHttpExceptions: true // FIX: sin esto, un token vencido lanzaba una excepción genérica de HTTP
                              // en vez de un mensaje claro de "token expirado" más abajo.
  });
  const mediaData = JSON.parse(mediaUrlResponse.getContentText());
  if (mediaData.error) {
    throw new Error("Meta Media API Error: " + mediaData.error.message + " (code " + mediaData.error.code + ")");
  }

  const audioResponse = UrlFetchApp.fetch(mediaData.url, {
    headers: { Authorization: `Bearer ${waToken}` },
    muteHttpExceptions: true
  });

  return audioResponse.getBlob().setName("audio.ogg");
}

/** Whisper Transcription */
function transcribeAudioWithWhisper(audioBlob, apiKey) {
  const url = "https://api.openai.com/v1/audio/transcriptions";
  const payload = { file: audioBlob, model: "whisper-1", language: "es" };
  const options = {
    method: "post",
    headers: { Authorization: "Bearer " + apiKey },
    payload: payload,
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  if (json.error) throw new Error("Whisper API Error: " + json.error.message);
  return json.text;
}

/** Audit Log */

function sendWhatsAppMessage(toPhoneNumber, messageText) {
  try {
    const waToken = PropertiesService.getScriptProperties().getProperty('WHATSAPP_TOKEN');
    const phoneId = CONFIG.WHATSAPP_PHONE_NUMBER_ID; // FIX v3.12: ahora viene de CONFIG, no fijo aquí
    const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;

    // Formatear número a 10 dígitos + código de país 52
    let cleanPhone = toPhoneNumber.toString().replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = '52' + cleanPhone;
    if (cleanPhone.startsWith('521') && cleanPhone.length === 13) {
      cleanPhone = '52' + cleanPhone.substring(3);
    }

    const payload = {
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "text",
      text: {
        body: messageText
      }
    };

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${waToken}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseText = response.getContentText();
    Logger.log("Respuesta Meta API enviada a " + cleanPhone + ": " + responseText);

    // FIX: antes esto no existía — ahora se detecta explícitamente el fallo.
    const parsed = JSON.parse(responseText);
    if (parsed.error) {
      const esTokenVencido = parsed.error.code === 190;
      const codeInfo = esTokenVencido
        ? " -> TOKEN DE WHATSAPP VENCIDO. Genera un token permanente de System User en Meta Business Suite (ver 'Próximos Pasos Técnicos')."
        : "";
      logErrorToDatabase("N/A", "Fallo enviando WhatsApp a " + cleanPhone + ": [" + parsed.error.code + "] " + parsed.error.message + codeInfo);

      // NUEVO v3.13: si es justo el TOKEN el que falló, avisar por WhatsApp no serviría
      // (es el mismo canal roto) — se avisa por correo, que no depende de este token.
      if (esTokenVencido && CONFIG.ADMIN_EMAIL) {
        enviarCorreo(CONFIG.ADMIN_EMAIL, '🚨 NexusVoice: token de WhatsApp vencido',
          `<p>El <b>WHATSAPP_TOKEN</b> venció (error 190 de Meta) — los mensajes salientes dejaron de llegar.</p>
           <p>Genera un token permanente de System User en Meta Business Suite y actualízalo en Propiedades del script.</p>`);
      }
    }
  } catch (e) {
    Logger.log("Error enviando WhatsApp: " + e.toString());
    try { logErrorToDatabase("N/A", "Excepción enviando WhatsApp: " + e.toString()); } catch (e2) { /* no-op */ }
  }
}

/**
 * Envía un resumen matutino diario con los eventos y tareas del día.
 * NUEVO v3.13: ahora es POR PERSONA — recorre CONFIG.USUARIOS y a cada quien le manda
 * el resumen de SU PROPIO calendario/lista (no el calendario por defecto de la cuenta),
 * por WhatsApp y también por correo (respaldo si el WhatsApp se pierde entre notificaciones).
 */
