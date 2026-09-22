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

// ==========================================
// NUEVO v3.6 — SESIONES, INVITADOS Y CONSULTA DE PENDIENTES
// ==========================================

/** Abre (o crea si no existe) la pestaña "Sesiones" con sus encabezados */
