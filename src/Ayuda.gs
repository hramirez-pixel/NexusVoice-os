function getMensajeAyuda() {
  return `💡 *Sugerencia de formato* (no es obligatorio, pero ayuda a que no me equivoque):\n\n`
    + `📅 *Para una cita en el calendario:* di primero el nombre del calendario, luego la palabra "cita", la fecha y hora, y el nombre del compromiso.\n`
    + `  _Ejemplo: "Trabajo, cita el viernes a las 10 de la mañana: reunión con el SAT"_\n\n`
    + `☑️ *Para una tarea/pendiente:* di la palabra "pendientes", el nombre de la lista, y el nombre de la tarea.\n`
    + `  _Ejemplo: "Pendientes, Personales: comprar pan para el viernes"_\n\n`
    + `Otros comandos útiles (por texto, no audio):\n`
    + `• *"ID-00X agrega a correo@x.com"* → invita a alguien a esa cita\n`
    + `• *"cancela la cita ID-00X"* / *"borra la reunión del viernes"* → cancela esa cita (busca por ID o por fecha/título)\n`
    + `• *"agrégale un comentario a la cita ID-00X: llevar el contrato"* → agrega una nota a la descripción de esa cita\n`
    + `• *"ya hice lo de enviar reportes"* / *"márcalo como hecho, nota: se mandó por correo"* → marca esa tarea como completada (con nota opcional)\n`
    + `• *"borra la tarea de enviar reportes"* → elimina esa tarea por completo (no la marca como hecha, la borra)\n`
    + `• *"anota en la tarea de enviar reportes que falta el anexo"* → agrega una nota SIN cerrar la tarea (sigue pendiente)\n`
    + `• *"qué tengo pendiente esta semana"* / *"qué tengo hoy"* / *"cómo se ve mi agenda del viernes"* → ve tu calendario y tareas reales de Google (citas + pendientes, incluyendo lo vencido)\n`
    + `• *"qué tiene Angy hoy"* / *"pendientes de Angy"* → lo mismo, pero de otra persona registrada (agenda compartida)\n`
    + `• *"notas pendientes de configurar"* → ve las notas de voz que no se pudieron clasificar solas\n`
    + `• *"N-00X agenda cita [fecha/hora] en [calendario]"* / *"N-00X genera tarea..."* / *"N-00X descartar"* → resuelve una nota pendiente\n`
    + `• *"mándame lo de hoy por correo"* → te llega también a tu email, por si el WhatsApp se pierde entre notificaciones`;
}

/** Fetch Media from Meta */
