// ==========================================
// NEXUSVOICE OS - CÓDIGO MAESTRO INTEGRADO V3.14 (CORREGIDO + INVITADOS + NOTAS + AYUDA)
// ==========================================
// Cambios respecto a v3.4 marcados con "// FIX:"
// Novedades v3.6: ID de sesión por cita/tarea, agregar invitados por WhatsApp
// (por ID, por fecha/hora, o por contexto reciente), y consulta de pendientes
// por rango de fechas. Ver pestaña nueva "Sesiones" en el Sheet.
// Novedades v3.7: leyenda de confirmación más clara, ID corto también para
// Notas_Pendientes (N-XXX), comando para listar/resolver notas sin configurar,
// mensaje de ayuda con formato sugerido, y recordatorio diario de notas sin configurar.
// Novedades v3.8: el tip de uso ya no se manda 3x/día por trigger fijo — ahora se
// manda solo cuando algo se malinterpreta (nota ambigua, cita sin fecha, error de
// destino), máximo 1 vez al día, además de estar siempre disponible con "ayuda".
// Novedades v3.9: UN SOLO clasificador (classifyIncomingMessage) para audio y texto,
// que reconoce sinónimos ("agrega"/"agregar"/"añade") y variantes de frase ("notas
// pendientes de/por configurar") por significado, no por texto exacto; los audios
// ahora también entienden comandos (antes solo el texto); si en el mismo audio se
// crea una cita Y se pide agregar un invitado, ambos se procesan juntos (antes el
// invitado se creaba como una tarea aparte por error); y se puede descartar TODAS
// las notas pendientes de una vez.
// Novedades v3.10: se corrige el cálculo de fechas relativas ("el próximo jueves",
// "el próximo lunes") que llegaban a fechas equivocadas — el modelo ya NO calcula
// offsets de días por su cuenta; se le da una tabla de los próximos 21 días (calculada
// en código, nunca falla) y solo tiene que buscar el nombre del día ahí.
// Novedades v3.11: "la próxima semana, el miércoles" ya no cae en el miércoles más
// cercano (eso sería solo "el miércoles") — ahora salta correctamente a la semana
// siguiente. Y los correos dictados o escritos con "arroba"/"punto" en vez de @/.
// (ej. "juan.perez.arroba.gmail.com") se normalizan automáticamente antes de validarse,
// tanto si vienen del mismo audio como si el usuario los corrige por texto.
// Novedades v3.12: el Phone Number ID de WhatsApp ya no está fijo dentro de
// sendWhatsAppMessage — ahora vive en CONFIG.WHATSAPP_PHONE_NUMBER_ID, para poder
// tener varias instancias (una cuenta por persona) sin arriesgarse a dejarlo mal
// copiado en alguna.
// Novedades v3.13: soporte multi-usuario dentro de UNA sola instancia (dos personas
// mandando audios al MISMO número de WhatsApp, bajo la MISMA cuenta de Google). Cada
// teléfono en CONFIG.USUARIOS tiene su propio calendario/lista por defecto; "pendientes"
// y "notas pendientes" ya no se mezclan entre personas; y se agregó un canal de correo
// (resumen diario + "mándame lo de hoy por correo" bajo demanda) como respaldo del
// WhatsApp, recomendado como UN solo correo combinado (citas + tareas) en vez de dos.
// Novedades v3.14: "trabajo"/"personal" dichos en voz se resuelven automáticamente al
// calendario propio de quien habla (sin que nadie tenga que decir su propio nombre);
// y se corrige un bug de raíz en "consultar pendientes"/"notas pendientes" — Google
// Sheets auto-convertía las fechas guardadas como texto a un valor de fecha real,
// rompiendo las comparaciones de rango. Ahora se normaliza al leer, sin importar
// cómo haya quedado guardada la celda.


const CONFIG = {
  WEBHOOK_VERIFY_TOKEN: "nexusvoice_secret_token_2026",
  TIMEZONE: "America/Cancun",
  SPREADSHEET_ID: "1CduPOy0s8qgpehpKclW7NYRQryIXZ3nmeGNad_eR4g8",
  ADMIN_EMAIL: "REEMPLAZA_CON_TU_CORREO@gmail.com", // NUEVO v3.13: solo para alertas críticas (ej. token de WhatsApp vencido) que no pueden avisarse por el propio WhatsApp roto
  WHATSAPP_PHONE_NUMBER_ID: "1399695953218801", // FIX v3.12: antes estaba fijo dentro de sendWhatsAppMessage — al tener varias instancias (una por cuenta), es fácil olvidar cambiarlo ahí y mandar mensajes por el número equivocado. Ahora es lo ÚNICO que hay que tocar.
  SESIONES_SHEET_NAME: "Sesiones", // nueva pestaña — se crea sola si no existe
  ID_PREFIX: "ID-",
  INVITE_WINDOW_MINUTES: 15, // ventana para decir "agrega a fulano@x.com" sin dar el ID
  // NUEVO v3.13: como ahora dos personas pueden mandar audios al MISMO número de
  // WhatsApp, aquí se define a qué calendario/lista cae cada quien POR DEFECTO
  // (cuando no menciona un destino explícito), según el teléfono que manda el audio.
  // La CLAVE debe ser EXACTAMENTE el número tal como llega de WhatsApp — revisa la
  // columna "sender_phone" en la pestaña Sesiones (o Auditoria_Logs) para copiarlo
  // tal cual, no lo escribas a mano.
  USUARIOS: {
    "5214431025894": { nombre: "Héctor", calendario: "Personales", lista: "Personales", trabajo: "Trabajo", correo: "hector.ramar@gmail.com" },
    // NUEVO v3.14: agregado "trabajo" arriba para Héctor (usa tu fila "Trabajo" que ya existe en Catalogo_Listas).
    // Ajuste posterior: se agregó "trabajo": "AngyTrabajo" para Angy — requiere que la fila
    // "AngyTrabajo" exista en Catalogo_Listas con su calendar_id (columna C). Antes de esto,
    // decir "trabajo" le caía a su calendario personal por falta de esta fila.
    "5219981898579": { nombre: "Angy", calendario: "AngyPersonal", lista: "AngyPersonal", trabajo: "AngyTrabajo", correo: "angelicaysasigonzalvez@hotmail.com" }
  },
  USUARIO_DEFAULT: { nombre: null, calendario: "ProyectoNexusVoice", lista: "ProyectoNexusVoice", correo: "nexus.voiceos@gmail.com" } // para números no registrados en USUARIOS
};


/** Devuelve el perfil (nombre, calendario/lista por defecto) del remitente, o el default */
function getUsuario(senderPhone) {
  return CONFIG.USUARIOS[senderPhone] || CONFIG.USUARIO_DEFAULT;
}

/**
 * NUEVO v3.14 — "trabajo" y "personal"/"personales" son palabras GENÉRICAS: cada
 * persona tiene su propio calendario detrás de esa palabra (Héctor → "Trabajo",
 * Angy → "TrabajoAngy", etc.), sin que nadie tenga que decir su propio nombre en
 * voz. Cualquier OTRO destino explícito (Proyecto, CustomerSuccess) es compartido
 * y se usa tal cual, igual que hasta ahora.
 */
const ALIAS_TRABAJO = ['trabajo', 'oficina', 'chamba'];
const ALIAS_PERSONAL = ['personal', 'personales', 'casa'];

function resolverDestinoCalendario(destinoDicho, usuario) {
  if (!destinoDicho) return usuario.calendario; // nada dicho → su calendario personal
  const d = destinoDicho.toString().toLowerCase().trim();
  if (ALIAS_TRABAJO.includes(d)) return usuario.trabajo || usuario.calendario; // si no tiene calendario de trabajo configurado, cae al personal
  if (ALIAS_PERSONAL.includes(d)) return usuario.calendario;
  return destinoDicho; // cualquier otro nombre (Proyecto, CustomerSuccess...) se usa tal cual — compartido entre todos
}

/** Validation (GET) */
