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

/** NUEVO — busca una tarea NO completada por título aproximado (substring en
 *  cualquier dirección, sin distinguir mayúsculas/minúsculas — las tareas no
 *  tienen ID corto como las Sesiones, así que esta es la única forma de
 *  encontrarlas) y la marca como completada, dejando una nota si se dio una.
 *  Devuelve { titulo } si se completó, o { error } si no se encontró / hubo
 *  ambigüedad / falló la llamada a la API. */
function completarTareaPorTitulo(taskListId, tituloBuscado, nota) {
  try {
    const result = Tasks.Tasks.list(taskListId, { showCompleted: false, showHidden: false });
    const items = result.getItems() || [];
    const target = tituloBuscado.toString().toLowerCase().trim();
    const matches = items.filter(t => {
      const titulo = t.getTitle().toLowerCase();
      return titulo.includes(target) || target.includes(titulo);
    });

    if (matches.length === 0) {
      return { error: `No encontré ninguna tarea pendiente que coincida con "${tituloBuscado}".` };
    }
    if (matches.length > 1) {
      const lista = matches.map(t => `• ${t.getTitle()}`).join('\n');
      return { error: `Encontré varias tareas que coinciden con "${tituloBuscado}", dime el título más exacto:\n\n${lista}` };
    }

    const tarea = matches[0];
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
