function doGet(e) {
  const mode = e ? e.parameter['hub.mode'] : null;
  const token = e ? e.parameter['hub.verify_token'] : null;
  const challenge = e ? e.parameter['hub.challenge'] : null;

  if (mode && token === CONFIG.WEBHOOK_VERIFY_TOKEN) {
    return ContentService.createTextOutput(challenge).setMimeType(ContentService.MimeType.TEXT);
  }
  return ContentService.createTextOutput("NexusVoice OS Webhook Activo").setMimeType(ContentService.MimeType.TEXT);
}

/** Incoming Webhook (POST) - Captura dinámica de quién envía el audio */
function doPost(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    if (contents.entry && contents.entry[0].changes && contents.entry[0].changes[0].value.messages) {
      const message = contents.entry[0].changes[0].value.messages[0];
      const senderPhone = message.from; // Número de tu celular personal que envía el mensaje

      if (message.type === 'audio') {
        processIncomingAudio(message.audio.id, senderPhone);
      }
      // FIX/NUEVO v3.9: los mensajes de texto ahora pasan por el mismo clasificador
      // unificado. Si describen un compromiso nuevo (modo NOTA), se avisa que las
      // notas nuevas se crean por audio (así queda la transcripción como respaldo);
      // si es un comando (agregar invitado, consultar pendientes, etc.), se procesa.
      else if (message.type === 'text' && message.text && message.text.body) {
        handleTextMessage(message.text.body, senderPhone);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

/** Main Pipeline */
