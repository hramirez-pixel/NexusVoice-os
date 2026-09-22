function getMensajeAyuda() {
  return `💡 *Sugerencia de formato* (no es obligatorio, pero ayuda a que no me equivoque):\n\n`
    + `📅 *Para una cita en el calendario:* di primero el nombre del calendario, luego la palabra "cita", la fecha y hora, y el nombre del compromiso.\n`
    + `  _Ejemplo: "Trabajo, cita el viernes a las 10 de la mañana: reunión con el SAT"_\n\n`
    + `☑️ *Para una tarea/pendiente:* di la palabra "pendientes", el nombre de la lista, y el nombre de la tarea.\n`
    + `  _Ejemplo: "Pendientes, Personales: comprar pan para el viernes"_\n\n`
    + `Otros comandos útiles (por texto, no audio):\n`
    + `• *"ID-00X agrega a correo@x.com"* → invita a alguien a esa cita\n`
    + `• *"qué tengo pendiente esta semana"* → ve tus citas/tareas ya agendadas (lo que le pediste a este bot)\n`
    + `• *"qué tengo hoy"* / *"cómo se ve mi agenda del viernes"* → ve tu calendario real de Google (todo, no solo lo agendado por aquí)\n`
    + `• *"notas pendientes de configurar"* → ve las notas de voz que no se pudieron clasificar solas\n`
    + `• *"N-00X agenda cita [fecha/hora] en [calendario]"* / *"N-00X genera tarea..."* / *"N-00X descartar"* → resuelve una nota pendiente\n`
    + `• *"mándame lo de hoy por correo"* → te llega también a tu email, por si el WhatsApp se pierde entre notificaciones`;
}

/** Fetch Media from Meta */
