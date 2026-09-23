/**
 * FIX (causa raíz de "qué tenía ayer" respondiendo "no tienes nada"): esta tabla
 * solo generaba fechas HACIA ADELANTE (i de 0 a `diasAdelante`) — "ayer" nunca
 * existía en ella, así que el clasificador no podía resolverlo y rango_desde/hasta
 * quedaba en null, cayendo al fallback de "hoy" en Pipeline.gs en silencio.
 * Ahora también incluye `diasAtras` días hacia atrás (i negativo), suficientes
 * para "ayer", "antier" y "la semana pasada, el [día]".
 */
function getTablaProximosDias(diasAdelante, diasAtras) {
  diasAtras = diasAtras || 0;
  const nombresDias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const ahora = new Date();
  const filas = [];
  for (let i = -diasAtras; i <= diasAdelante; i++) {
    const d = new Date(ahora.getTime() + i * 86400000);
    const fechaStr = Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd");
    // Se ancla a mediodía UTC sobre los componentes de la fecha (no al objeto "d" original)
    // para que el nombre del día no dependa del locale del proyecto ni de líos de DST.
    const partes = fechaStr.split('-').map(Number);
    const diaSemana = nombresDias[new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 12)).getUTCDay()];
    let etiqueta = diaSemana;
    if (i === 0) etiqueta += ' (HOY)';
    else if (i === 1) etiqueta += ' (mañana)';
    else if (i === -1) etiqueta += ' (ayer)';
    else if (i === -2) etiqueta += ' (antier)';
    filas.push(`${fechaStr} = ${etiqueta}`);
  }
  return filas.join(', ');
}

function classifyIncomingMessage(text, apiKey) {
  const url = "https://api.openai.com/v1/chat/completions";
  const now = new Date();
  const currentDateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd (EEEE)");
  const tablaDias = getTablaProximosDias(21, 7); // FIX v3.10: calendario de respaldo para no calcular fechas "a mano" — +7 días atrás para poder resolver "ayer"/"antier"/"la semana pasada"
  // NUEVO: agenda compartida — personas cuya agenda se puede consultar, incluyendo alias
  // (ej. "Angy" también se puede decir "Angie"/"Angélica") para que el modelo los reconozca
  // directamente, sin depender solo de la red de seguridad en Pipeline.gs.
  const nombresRegistrados = Object.values(CONFIG.USUARIOS)
    .filter(u => u.nombre)
    .map(u => (u.alias && u.alias.length) ? `${u.nombre} (también: ${u.alias.join(', ')})` : u.nombre)
    .join('; ');

  const prompt = `Hoy es ${currentDateStr} en la zona horaria ${CONFIG.TIMEZONE}. Un asistente de WhatsApp que agenda citas/tareas recibió este mensaje (puede venir de una nota de voz transcrita, o escrito directamente).

  Mensaje: "${text}"

  CALENDARIO DE LOS ÚLTIMOS 7 DÍAS Y LOS PRÓXIMOS 21 DÍAS (úsalo para CUALQUIER fecha relativa, pasada o futura — NUNCA calcules tú mismo cuántos días faltan/pasaron para "el jueves", "el próximo lunes", "ayer" o "antier"; busca el nombre del día aquí y copia su fecha exacta):
  ${tablaDias}
  Si el usuario dice "el próximo [día]" o solo "[día]" sin más contexto, usa la fecha MÁS CERCANA de ese día en la tabla (la primera que aparezca después de hoy). Si dice "en ocho días" o "en dos semanas", cuenta esa cantidad de filas en la tabla, no de memoria. Si dice "ayer" o "antier", usa esas fechas ya marcadas en la tabla. Si dice "la semana pasada, el [día]", usa la aparición de ese día ANTES de hoy en la tabla.
  IMPORTANTE: si el usuario menciona EXPLÍCITAMENTE "la próxima semana", "la semana que viene" o "la semana que entra" JUNTO con un día (ej. "la próxima semana, el miércoles"), eso NO es lo mismo que solo "el miércoles" — usa la SEGUNDA aparición de ese día en la tabla (salta la más cercana), es decir, 7 días después de la fecha más cercana de ese día.

  PRIMERO decide el "modo":
  - "NOTA": el mensaje describe uno o más compromisos NUEVOS a crear (una cita con fecha/hora, o una tarea con fecha de vencimiento) — aunque también mencione, en el mismo mensaje, agregar un invitado a esa cita nueva.
  - "COMANDO": el mensaje NO describe ningún compromiso nuevo que agendar. Solo pide una acción sobre algo que YA EXISTE: agregar un invitado, cancelar o comentar una cita YA CREADA (por ID o por fecha/referencia, sin dar un compromiso nuevo), avisar que una tarea YA CREADA se completó, eliminarla, o anotarla sin cerrarla, consultar citas/tareas ya agendadas, consultar o resolver notas pendientes de configurar, o pedir ayuda.

  ==== SI modo es "NOTA" ====
  Extrae cada compromiso en "acciones":
  1. Verbos como "entregar", "revisar", "comprar", "enviar" asociados a una fecha son TAREAS, NO citas.
  2. Si hay MÚLTIPLES instrucciones, desglosa cada una como un objeto en 'acciones'.
  3. Si la instrucción no es clara, dudas entre Cita y Tarea, o no puedes resolver una fecha relativa a una fecha exacta CON LA TABLA DE ARRIBA, pon "es_ambiguo": true y explica en "mensaje_duda". NUNCA dejes una fecha relativa sin resolver en "fecha_hora", y NUNCA inventes una fecha que no esté respaldada por la tabla.
  4. "fecha_hora" debe ser EXACTAMENTE "YYYY-MM-DD HH:mm" (24h), o "YYYY-MM-DD" si solo hay fecha, o null.
  5. Una CITA SIEMPRE debe llevar fecha_hora resuelta; si no la dio, márcala ambigua.
  6. "destino" es el nombre EXACTO que el usuario mencionó (calendario o lista). Si no mencionó ninguno, "destino": null — nunca inventes un nombre genérico. El destino casi siempre va AL PRINCIPIO del mensaje, antes de la palabra "cita"/"pendientes", con o sin coma/dos puntos separándolo del resto (ej. "Trabajo, cita el viernes a las 10 con el SAT" → destino: "Trabajo", SIN importar que no haya ":" antes del título — no necesitas puntuación exacta para reconocerlo, el patrón es "[destino], cita/pendientes [fecha] [preposición: "de"/"con"/":"] [título]"). No confundas el destino con parte del título: en "Trabajo, cita el viernes con el SAT", el título es "cita con el SAT" (o similar) y el destino es "Trabajo", NO al revés.
  7. Si en el mismo mensaje se pide agregar/invitar a alguien (con correo) a la cita que se está creando, ponlo en "invitados" de esa acción (arreglo de strings). Solo aplica a CITA. Si el correo dictado no tiene forma válida (le falta la @, por transcripción de audio), inclúyelo igual tal cual — se valida después.

  ==== SI modo es "COMANDO" ====
  Clasifica "intent":
  - AGREGAR_INVITADO: agregar/añadir/invitar a alguien (correo) a una cita YA CREADA, por ID de sesión ("ID-001") o por fecha/título aproximado. Cualquier verbo con ese sentido cuenta ("agrega", "agregar", "añade", "invita", "pon a", etc.) — no exijas una palabra exacta.
  - CANCELAR_CITA: cancelar/borrar/eliminar una CITA YA CREADA (no una tarea), por ID de sesión o por fecha/título aproximado — mismos campos que AGREGAR_INVITADO ("id_sesion" o "fecha_hora_referencia"+"titulo_referencia"). Reconócelo por verbos de eliminar aplicados a una cita/reunión que YA EXISTE ("cancela", "borra", "elimina", "quita la cita de..."). NUNCA lo confundas con AGREGAR_INVITADO (que agrega, no borra) ni con ELIMINAR_TAREA (esto es solo para CITAS, no tareas).
  - EDITAR_COMENTARIO_CITA: agregar un comentario/nota/descripción a una CITA YA CREADA (no una tarea), por ID de sesión o por fecha/título aproximado — mismos campos que AGREGAR_INVITADO. Reconócelo por frases como "agrégale un comentario a la cita de...", "ponle de nota a la reunión...", "anota en la cita...". "comentario_cita" es el texto exacto del comentario (obligatorio).
  - COMPLETAR_TAREA: avisa que UNA O VARIAS tareas/pendientes YA CREADAS se terminaron/hicieron/completaron, cada una por su título aproximado (no por ID — las tareas no tienen ID corto). Reconócelo por el SIGNIFICADO ("ya hice...", "ya terminé...", "márcalo/marca como hecho/completado/completada/lista...", "termina la tarea de..."), no por frase exacta. Si el mensaje menciona VARIAS tareas (ej. "marca como completado entregar reportes y test pendiente"), pon CADA título por separado en "titulos_tarea" (arreglo) — no las combines en un solo string. Ejemplo: "Marca como completada la tarea pendiente de enviar reportes" → intent: COMPLETAR_TAREA, titulos_tarea: ["enviar reportes"] (la palabra "pendiente" aquí es solo describiendo QUÉ tarea es, NO la disparas a CONSULTAR_PENDIENTES — el verbo "marca/completa" manda, no la palabra "pendiente"). Si en el mismo mensaje deja una nota sobre cómo/cuándo se hizo, extráela aparte (se aplica a todas las tareas mencionadas) — NUNCA confundas esto con crear una tarea nueva (modo NOTA).
  - ELIMINAR_TAREA: BORRAR por completo una o varias tareas YA CREADAS (no solo marcarlas como hechas), cada una por su título aproximado — usa "titulos_tarea" igual que COMPLETAR_TAREA. Reconócelo por verbos de eliminar ("borra/elimina/quita la tarea de...", "ya no sirve el pendiente de..."). DISTINTO de COMPLETAR_TAREA: esto es para tareas que ya NO aplican (se borran), no para tareas que SÍ se hicieron (esas se completan, no se borran).
  - EDITAR_NOTA_TAREA: agregar una nota/comentario a una o varias tareas YA CREADAS SIN marcarlas como completadas — la tarea sigue abierta. Usa "titulos_tarea" igual que COMPLETAR_TAREA, y aquí "nota_tarea" es OBLIGATORIO (es el punto del mensaje). Reconócelo por frases que piden anotar/comentar SIN decir que ya se terminó (ej. "anota en la tarea de enviar reportes que ya se mandó el borrador, pero no la cierres todavía", "déjale un comentario a la tarea de X"). DISTINTO de COMPLETAR_TAREA: si el mensaje implica que la tarea YA se completó del todo, es COMPLETAR_TAREA aunque también deje nota; esto es solo para anotar avances sin cerrarla.
  - CONSULTAR_PENDIENTES: PREGUNTA qué hay pendiente, no reporta que algo ya se hizo (ej. "mis pendientes", "pendientes de Angy", "qué tengo pendiente esta semana"). Si el verbo es "marcar/completar/terminar algo que YA se hizo", es COMPLETAR_TAREA aunque el mensaje también diga la palabra "pendiente".
  - CONSULTAR_AGENDA: pregunta de forma general SIN decir "pendientes" (ej. "qué tengo hoy", "cómo se ve mi agenda mañana", "qué tengo el viernes", "agenda de esta semana").
  CONSULTAR_PENDIENTES y CONSULTAR_AGENDA muestran EXACTAMENTE lo mismo — el estado REAL de Calendar + Tasks (citas y tareas reales, no solo lo creado por este bot) — solo cambia la palabra que las dispara. Ambas pueden preguntar por la agenda de OTRA persona registrada (ej. "pendientes de Angy", "qué tiene Héctor mañana") — personas registradas: ${nombresRegistrados}.
  - CONSULTAR_NOTAS_PENDIENTES: ver notas de voz que no se pudieron clasificar solas y siguen sin resolver. Reconócelo por el SIGNIFICADO ("notas pendientes de/por configurar/definir/resolver"), no por frase exacta.
  - RESOLVER_NOTA_PENDIENTE: decidir qué hacer con una nota pendiente (ID "N-001", o "TODAS" para todas a la vez): descartar, agendar cita, o generar tarea.
  - AYUDA: pide instrucciones o cómo usar el sistema.
  - OTRO: cualquier otra cosa que no encaje.

  Reglas del comando:
  - Un ID "ID-003" es de una sesión/cita ya creada; un ID "N-003" es de una nota pendiente. No los confundas.
  - Si pide actuar sobre TODAS las notas a la vez, "nota_id": "TODAS".
  - Resuelve TODA fecha relativa POR NOMBRE DE DÍA (fecha_hora_referencia, rango_desde, rango_hasta, fecha_hora_nueva) usando la MISMA tabla de calendario de arriba — no calcules offsets de días tú mismo. "Esta semana" = desde hoy hasta el domingo más cercano de la tabla. La tabla solo cubre ~1 mes (7 días atrás, 21 adelante) — si el usuario da un MES o fecha EXPLÍCITA fuera de ese rango (ej. "todos los pendientes de septiembre", "del 1 al 15 de octubre", "todo el mes pasado"), la tabla no lo cubre: en ese caso SÍ calcula tú mismo el rango exacto (YYYY-MM-01 a YYYY-MM-último_día) usando la fecha de hoy de arriba como referencia de año — si el mes mencionado ya pasó este año y no se dijo "del año pasado", asume que se refiere al mes más próximo (puede ser este año o el próximo, el que quede más cerca de hoy).
  - Para RESOLVER_NOTA_PENDIENTE, "accion_nota" es "DESCARTAR", "AGENDAR_CITA" o "GENERAR_TAREA"; si agenda/genera, extrae "fecha_hora_nueva" y "destino_nuevo" si los da.
  - Para CONSULTAR_PENDIENTES o CONSULTAR_AGENDA: si el usuario pide explícitamente que se lo mandes/envíes "por correo"/"por email"/"a mi correo" (ej. "mándame las sesiones de hoy por correo"), pon "porCorreo": true. Si solo pregunta normalmente (sin pedir correo), "porCorreo": false. "destino_agenda" es el calendario que pregunta (ej. "trabajo", "personal", o un nombre explícito como "Proyecto"), igual que "destino" en modo NOTA. Si no menciona ninguno, "destino_agenda": null (su calendario por defecto). "persona_agenda" es el nombre de la persona registrada cuya agenda pregunta (ej. "Angy"), SOLO si es un nombre de la lista de personas registradas de arriba — NUNCA lo confundas con "destino_agenda" (un nombre de calendario/lista, no de persona). Si pregunta por su propia agenda, "persona_agenda": null.
  - Para COMPLETAR_TAREA, ELIMINAR_TAREA o EDITAR_NOTA_TAREA: "titulos_tarea" es un ARREGLO con el texto aproximado de cada tarea afectada (obligatorio, al menos un elemento — sin esto no se puede encontrar cuál tarea es; casi siempre trae 1 elemento, pero puede traer varios si el mensaje menciona más de una). "nota_tarea" es la nota/comentario a dejar (para EDITAR_NOTA_TAREA es OBLIGATORIO; para COMPLETAR_TAREA es OPCIONAL — null si no dejó ninguna; para ELIMINAR_TAREA no aplica, déjalo null). Se aplica igual a todas las tareas del arreglo. Los tres también aceptan "destino_agenda"/"persona_agenda" igual que arriba, por si la(s) tarea(s) son de otra persona registrada.
  - Para CANCELAR_CITA o EDITAR_COMENTARIO_CITA: usa "id_sesion" o "fecha_hora_referencia"+"titulo_referencia" igual que AGREGAR_INVITADO para identificar la cita. Para EDITAR_COMENTARIO_CITA, "comentario_cita" es el texto del comentario a agregar (obligatorio).
  - No exijas coincidencia literal de palabras para NINGUNA intención — interpreta el significado natural, como lo haría un humano.

  Responde UNICAMENTE este JSON (deja en null/[]/false lo que no aplique según el modo):
  {
    "modo": "NOTA | COMANDO",
    "es_ambiguo": false,
    "mensaje_duda": null,
    "acciones": [
      { "tipo": "CITA | TAREA", "titulo": "texto", "fecha_hora": "YYYY-MM-DD HH:mm o YYYY-MM-DD o null", "destino": "texto o null", "invitados": ["correo@ejemplo.com"] }
    ],
    "intent": "AGREGAR_INVITADO | CANCELAR_CITA | EDITAR_COMENTARIO_CITA | COMPLETAR_TAREA | ELIMINAR_TAREA | EDITAR_NOTA_TAREA | CONSULTAR_PENDIENTES | CONSULTAR_AGENDA | CONSULTAR_NOTAS_PENDIENTES | RESOLVER_NOTA_PENDIENTE | AYUDA | OTRO",
    "id_sesion": "ID-XXX o null",
    "email": "correo@ejemplo.com o null",
    "fecha_hora_referencia": "YYYY-MM-DD o null",
    "titulo_referencia": "texto o null",
    "comentario_cita": "texto o null",
    "rango_desde": "YYYY-MM-DD o null",
    "rango_hasta": "YYYY-MM-DD o null",
    "destino_agenda": "texto o null",
    "persona_agenda": "nombre o null",
    "titulos_tarea": ["texto"],
    "nota_tarea": "texto o null",
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
 * NUEVO — herramienta de diagnóstico manual: corre el clasificador contra un
 * texto de prueba y muestra el JSON completo que devolvió, sin pasar por
 * WhatsApp. Correr manualmente desde el editor (seleccionar esta función en
 * el menú de arriba → Ejecutar) y revisar el resultado en Ver → Registros
 * (o "Ejecuciones" en el panel izquierdo). Útil cuando un mensaje no se
 * clasifica como se espera y hace falta ver el "intent"/campos reales
 * devueltos por el modelo, en vez de adivinar por el prompt.
 */
function debug_clasificar(texto) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  const resultado = classifyIncomingMessage(texto || 'trabajo, cita, jueves a las cuatro de la tarde, Juan Pérez', apiKey);
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
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
