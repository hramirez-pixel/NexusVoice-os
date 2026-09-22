function getTablaProximosDias(dias) {
  const nombresDias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const ahora = new Date();
  const filas = [];
  for (let i = 0; i <= dias; i++) {
    const d = new Date(ahora.getTime() + i * 86400000);
    const fechaStr = Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd");
    // Se ancla a mediodía UTC sobre los componentes de la fecha (no al objeto "d" original)
    // para que el nombre del día no dependa del locale del proyecto ni de líos de DST.
    const partes = fechaStr.split('-').map(Number);
    const diaSemana = nombresDias[new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 12)).getUTCDay()];
    let etiqueta = diaSemana;
    if (i === 0) etiqueta += ' (HOY)';
    else if (i === 1) etiqueta += ' (mañana)';
    filas.push(`${fechaStr} = ${etiqueta}`);
  }
  return filas.join(', ');
}

function classifyIncomingMessage(text, apiKey) {
  const url = "https://api.openai.com/v1/chat/completions";
  const now = new Date();
  const currentDateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd (EEEE)");
  const tablaDias = getTablaProximosDias(21); // FIX v3.10: calendario de respaldo para no calcular fechas "a mano"

  const prompt = `Hoy es ${currentDateStr} en la zona horaria ${CONFIG.TIMEZONE}. Un asistente de WhatsApp que agenda citas/tareas recibió este mensaje (puede venir de una nota de voz transcrita, o escrito directamente).

  Mensaje: "${text}"

  CALENDARIO DE LOS PRÓXIMOS 21 DÍAS (úsalo para CUALQUIER fecha relativa — NUNCA calcules tú mismo cuántos días faltan para "el jueves" o "el próximo lunes"; busca el nombre del día aquí y copia su fecha exacta):
  ${tablaDias}
  Si el usuario dice "el próximo [día]" o solo "[día]" sin más contexto, usa la fecha MÁS CERCANA de ese día en la tabla (la primera que aparezca después de hoy). Si dice "en ocho días" o "en dos semanas", cuenta esa cantidad de filas en la tabla, no de memoria.
  IMPORTANTE: si el usuario menciona EXPLÍCITAMENTE "la próxima semana", "la semana que viene" o "la semana que entra" JUNTO con un día (ej. "la próxima semana, el miércoles"), eso NO es lo mismo que solo "el miércoles" — usa la SEGUNDA aparición de ese día en la tabla (salta la más cercana), es decir, 7 días después de la fecha más cercana de ese día.

  PRIMERO decide el "modo":
  - "NOTA": el mensaje describe uno o más compromisos NUEVOS a crear (una cita con fecha/hora, o una tarea con fecha de vencimiento) — aunque también mencione, en el mismo mensaje, agregar un invitado a esa cita nueva.
  - "COMANDO": el mensaje NO describe ningún compromiso nuevo que agendar. Solo pide una acción sobre algo que YA EXISTE: agregar un invitado a una cita YA CREADA (por ID o por fecha/referencia, sin dar un compromiso nuevo), consultar citas/tareas ya agendadas, consultar o resolver notas pendientes de configurar, o pedir ayuda.

  ==== SI modo es "NOTA" ====
  Extrae cada compromiso en "acciones":
  1. Verbos como "entregar", "revisar", "comprar", "enviar" asociados a una fecha son TAREAS, NO citas.
  2. Si hay MÚLTIPLES instrucciones, desglosa cada una como un objeto en 'acciones'.
  3. Si la instrucción no es clara, dudas entre Cita y Tarea, o no puedes resolver una fecha relativa a una fecha exacta CON LA TABLA DE ARRIBA, pon "es_ambiguo": true y explica en "mensaje_duda". NUNCA dejes una fecha relativa sin resolver en "fecha_hora", y NUNCA inventes una fecha que no esté respaldada por la tabla.
  4. "fecha_hora" debe ser EXACTAMENTE "YYYY-MM-DD HH:mm" (24h), o "YYYY-MM-DD" si solo hay fecha, o null.
  5. Una CITA SIEMPRE debe llevar fecha_hora resuelta; si no la dio, márcala ambigua.
  6. "destino" es el nombre EXACTO que el usuario mencionó (calendario o lista). Si no mencionó ninguno, "destino": null — nunca inventes un nombre genérico.
  7. Si en el mismo mensaje se pide agregar/invitar a alguien (con correo) a la cita que se está creando, ponlo en "invitados" de esa acción (arreglo de strings). Solo aplica a CITA. Si el correo dictado no tiene forma válida (le falta la @, por transcripción de audio), inclúyelo igual tal cual — se valida después.

  ==== SI modo es "COMANDO" ====
  Clasifica "intent":
  - AGREGAR_INVITADO: agregar/añadir/invitar a alguien (correo) a una cita YA CREADA, por ID de sesión ("ID-001") o por fecha/título aproximado. Cualquier verbo con ese sentido cuenta ("agrega", "agregar", "añade", "invita", "pon a", etc.) — no exijas una palabra exacta.
  - CONSULTAR_PENDIENTES: ver citas/tareas YA AGENDADAS de un día o rango.
  - CONSULTAR_NOTAS_PENDIENTES: ver notas de voz que no se pudieron clasificar solas y siguen sin resolver. Reconócelo por el SIGNIFICADO ("notas pendientes de/por configurar/definir/resolver"), no por frase exacta.
  - RESOLVER_NOTA_PENDIENTE: decidir qué hacer con una nota pendiente (ID "N-001", o "TODAS" para todas a la vez): descartar, agendar cita, o generar tarea.
  - AYUDA: pide instrucciones o cómo usar el sistema.
  - OTRO: cualquier otra cosa que no encaje.

  Reglas del comando:
  - Un ID "ID-003" es de una sesión/cita ya creada; un ID "N-003" es de una nota pendiente. No los confundas.
  - Si pide actuar sobre TODAS las notas a la vez, "nota_id": "TODAS".
  - Resuelve TODA fecha relativa (fecha_hora_referencia, rango_desde, rango_hasta, fecha_hora_nueva) usando la MISMA tabla de calendario de arriba — no calcules offsets de días tú mismo. "Esta semana" = desde hoy hasta el domingo más cercano de la tabla.
  - Para RESOLVER_NOTA_PENDIENTE, "accion_nota" es "DESCARTAR", "AGENDAR_CITA" o "GENERAR_TAREA"; si agenda/genera, extrae "fecha_hora_nueva" y "destino_nuevo" si los da.
  - Para CONSULTAR_PENDIENTES: si el usuario pide explícitamente que se lo mandes/envíes "por correo"/"por email"/"a mi correo" (ej. "mándame las sesiones de hoy por correo"), pon "porCorreo": true. Si solo pregunta normalmente (sin pedir correo), "porCorreo": false.
  - No exijas coincidencia literal de palabras para NINGUNA intención — interpreta el significado natural, como lo haría un humano.

  Responde UNICAMENTE este JSON (deja en null/[]/false lo que no aplique según el modo):
  {
    "modo": "NOTA | COMANDO",
    "es_ambiguo": false,
    "mensaje_duda": null,
    "acciones": [
      { "tipo": "CITA | TAREA", "titulo": "texto", "fecha_hora": "YYYY-MM-DD HH:mm o YYYY-MM-DD o null", "destino": "texto o null", "invitados": ["correo@ejemplo.com"] }
    ],
    "intent": "AGREGAR_INVITADO | CONSULTAR_PENDIENTES | CONSULTAR_NOTAS_PENDIENTES | RESOLVER_NOTA_PENDIENTE | AYUDA | OTRO",
    "id_sesion": "ID-XXX o null",
    "email": "correo@ejemplo.com o null",
    "fecha_hora_referencia": "YYYY-MM-DD o null",
    "titulo_referencia": "texto o null",
    "rango_desde": "YYYY-MM-DD o null",
    "rango_hasta": "YYYY-MM-DD o null",
    "nota_id": "N-XXX o TODAS o null",
    "accion_nota": "DESCARTAR | AGENDAR_CITA | GENERAR_TAREA o null",
    "fecha_hora_nueva": "YYYY-MM-DD HH:mm o YYYY-MM-DD o null",
    "destino_nuevo": "texto o null",
    "porCorreo": false
  }`;

  const payload = {
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  if (json.error) throw new Error("OpenAI API Error: " + json.error.message);
  return JSON.parse(json.choices[0].message.content);
}

/**
 * Búsqueda en Catalogo_Listas.
 * FIX: la versión anterior usaba doble ".includes()" cruzado, lo que causaba:
 *   (a) que una fila vacía (list_name === "") hiciera match SIEMPRE, porque
 *       cualquier texto ".includes('')" es true en JavaScript — cualquier fila
 *       vacía al final de la hoja podía secuestrar el ruteo.
 *   (b) que coincidencias parciales tempranas (ej. "Trabajo Urgente" contiene
 *       "trabajo") ganaran sobre la coincidencia exacta que aparece más abajo
 *       en la hoja, mandando citas/tareas al calendario o lista equivocada.
 * Ahora se prioriza: 1) coincidencia exacta, 2) coincidencia por prefijo,
 * 3) coincidencia parcial (con filas vacías explícitamente ignoradas).
 */
