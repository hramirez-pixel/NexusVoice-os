function createGoogleTask(title, dueDateString, taskListId) {
  try {
    const task = Tasks.newTask();
    task.setTitle(title);
    if (dueDateString) {
      const parsed = parseFechaHora(dueDateString); // FIX: mismo parseo manual que Calendar
      if (parsed) {
        task.setDue(parsed.date.toISOString());
      }
    }
    const targetList = (!taskListId || taskListId === 'primary') ? '@default' : taskListId;
    const createdTask = Tasks.Tasks.insert(task, targetList);
    return { id: createdTask.getId() };
  } catch (error) {
    Logger.log("Error creando tarea en Google Tasks: " + error.toString());
    // FIX: causa típica aquí -> el servicio avanzado "Tasks" no está activado en el
    // proyecto de Apps Script (Servicios ➔ Google Tasks API), lo que hace fallar
    // TODAS las tareas en silencio. Revisa esto primero si "TAREA" nunca funciona.
    return { id: null, error: error.toString() };
  }
}

/** Task List Lookup */
function getTaskListIdByName(listName) {
  try {
    if (!listName || listName === '@default') return '@default';
    const taskLists = Tasks.Tasklists.list().getItems();
    if (taskLists) {
      for (let i = 0; i < taskLists.length; i++) {
        if (taskLists[i].getTitle().toLowerCase().includes(listName.toString().toLowerCase())) {
          return taskLists[i].getId();
        }
      }
    }
  } catch (e) {
    Logger.log("No se encontró la lista de Tasks: " + e);
  }
  return '@default';
}

/** Normaliza texto para comparar títulos "a ojo": minúsculas, sin acentos,
 *  sin espacios — así "test pendiente" (como lo dictó/escribió alguien)
 *  coincide con la tarea real "testpendiente" (como haya quedado guardada). */
function normalizarParaComparar(str) {
  return str.toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');
}

/** NUEVO — busca UNA tarea NO completada por título aproximado (substring en
 *  cualquier dirección, ignorando mayúsculas/minúsculas, acentos y espacios —
 *  las tareas no tienen ID corto como las Sesiones, así que esta es la única
 *  forma de encontrarlas). Devuelve { tarea } o { error } si no hay 0 o más
 *  de 1 coincidencia. Compartida por completar/eliminar/anotar tarea, para
 *  no repetir esta búsqueda en cada una. */
function buscarTareaAbiertaPorTitulo(taskListId, tituloBuscado) {
  const result = Tasks.Tasks.list(taskListId, { showCompleted: false, showHidden: false });
  const items = result.getItems() || [];
  const target = normalizarParaComparar(tituloBuscado);
  const matches = items.filter(t => {
    const titulo = normalizarParaComparar(t.getTitle());
    return titulo.includes(target) || target.includes(titulo);
  });

  if (matches.length === 0) {
    return { error: `No encontré ninguna tarea pendiente que coincida con "${tituloBuscado}".` };
  }
  if (matches.length > 1) {
    const lista = matches.map(t => `• ${t.getTitle()}`).join('\n');
    return { error: `Encontré varias tareas que coinciden con "${tituloBuscado}", dime el título más exacto:\n\n${lista}` };
  }
  return { tarea: matches[0] };
}

/** Marca una tarea como completada (por título aproximado), dejando una nota
 *  si se dio una. Devuelve { titulo } o { error }. */
function completarTareaPorTitulo(taskListId, tituloBuscado, nota) {
  try {
    const encontrada = buscarTareaAbiertaPorTitulo(taskListId, tituloBuscado);
    if (encontrada.error) return encontrada;
    const tarea = encontrada.tarea;
    const notaExistente = tarea.getNotes();
    const notaFinal = nota ? (notaExistente ? notaExistente + '\n' + nota : nota) : notaExistente;
    const patchResource = { status: 'completed', completed: new Date().toISOString() };
    if (notaFinal) patchResource.notes = notaFinal;
    Tasks.Tasks.patch(patchResource, taskListId, tarea.getId());
    return { titulo: tarea.getTitle() };
  } catch (e) {
    Logger.log("Error completando tarea: " + e.toString());
    return { error: 'Hubo un error marcando la tarea como completada. Intenta de nuevo o revisa Auditoria_Logs.' };
  }
}

/** NUEVO — elimina (borra) una tarea por título aproximado, SIN pasar por
 *  "completada" — para tareas que ya no aplican, a diferencia de
 *  completarTareaPorTitulo (que es para tareas que SÍ se hicieron). */
function eliminarTareaPorTitulo(taskListId, tituloBuscado) {
  try {
    const encontrada = buscarTareaAbiertaPorTitulo(taskListId, tituloBuscado);
    if (encontrada.error) return encontrada;
    Tasks.Tasks.remove(taskListId, encontrada.tarea.getId());
    return { titulo: encontrada.tarea.getTitle() };
  } catch (e) {
    Logger.log("Error eliminando tarea: " + e.toString());
    return { error: 'Hubo un error eliminando la tarea. Intenta de nuevo o revisa Auditoria_Logs.' };
  }
}

/** NUEVO — agrega una nota a una tarea por título aproximado SIN marcarla
 *  como completada (a diferencia de completarTareaPorTitulo) — para anotar
 *  avances sin cerrar la tarea todavía. */
function editarNotaTareaPorTitulo(taskListId, tituloBuscado, nota) {
  try {
    const encontrada = buscarTareaAbiertaPorTitulo(taskListId, tituloBuscado);
    if (encontrada.error) return encontrada;
    const tarea = encontrada.tarea;
    const notaExistente = tarea.getNotes();
    const notaFinal = notaExistente ? notaExistente + '\n' + nota : nota;
    Tasks.Tasks.patch({ notes: notaFinal }, taskListId, tarea.getId());
    return { titulo: tarea.getTitle() };
  } catch (e) {
    Logger.log("Error anotando tarea: " + e.toString());
    return { error: 'Hubo un error agregando la nota. Intenta de nuevo o revisa Auditoria_Logs.' };
  }
}

/** NUEVO — tareas NO completadas con vencimiento dentro de un rango de fechas
 *  (ambas inclusive). Usado por CONSULTAR_AGENDA para unificar citas + tareas,
 *  ej. para que "qué tenía ayer" también traiga pendientes vencidos de ese día. */
function getTareasEnRango(taskListId, desdeStr, hastaStr) {
  try {
    const inicio = parseFechaHora(desdeStr).date;
    const finExclusivo = new Date(parseFechaHora(hastaStr).date.getTime() + 86400000); // +1 día: dueMax es exclusivo
    const result = Tasks.Tasks.list(taskListId, {
      dueMin: inicio.toISOString(),
      dueMax: finExclusivo.toISOString(),
      showCompleted: false
    });
    return result.getItems() || [];
  } catch (e) {
    Logger.log("Error consultando tareas en rango: " + e.toString());
    return [];
  }
}

// ==========================================
// NUEVO v3.6 — SESIONES, INVITADOS Y CONSULTA DE PENDIENTES
// ==========================================

/** Abre (o crea si no existe) la pestaña "Sesiones" con sus encabezados */
