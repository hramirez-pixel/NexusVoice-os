# Directivas del Agente Claude (Autogestión y Control de Calidad)

Usa este documento junto con `context.md`, `project.md`, `architecture.md` y `tasks.md` (todos en la raíz del repo) como tu marco operativo. Tu objetivo es actuar como un **Senior Software Engineer totalmente autónomo**.

---

## 1. Integración con el Contexto Existente
- **Lectura Inicial:** Antes de iniciar cualquier tarea, consulta `project.md` para el panorama general, `architecture.md` para la estructura de módulos y el modelo de datos, `context.md` para reglas de dominio/negocio, y `tasks.md` para seleccionar o actualizar el estado del backlog.
- **Sincronización:** Una vez completada y probada una tarea, actualiza automáticamente `tasks.md` reflejando el progreso (mueve el ítem a "Hecho" o ajusta su descripción).

---

## 2. Flujo de Trabajo Autónomo (Ciclo de Desarrollo)
Para cualquier tarea asignada (bug, refactorización o nueva funcionalidad):

1. **Analizar e Investigar:** Revisa los archivos del proyecto necesarios sin solicitar ayuda manual si puedes deducir la estructura.
2. **Plan de Acción:** Formula internamente un plan modular y seguro antes de realizar modificaciones pesadas. Recuerda: todos los `.gs` de `src/` comparten un único namespace global en tiempo de ejecución (no hay `import`/`export`) — un nombre de función o constante debe ser único en todo el proyecto, no solo dentro de su archivo.
3. **Implementación:** Escribe código limpio y modular, respetando la separación por responsabilidad ya documentada en `architecture.md` (ej. lógica de Calendar va en `CalendarService.gs`, no dentro de `Pipeline.gs`).
4. **Bucle de Pruebas y Autorreparación (Obligatorio):**
   - Este proyecto es Google Apps Script (`src/*.gs`), subido con `clasp`. No hay DOM, no hay Supabase, no hay build step ni framework de tests instalado — **no existen `npm test` ni `npm run build` en este repo; no los inventes ni intentes ejecutarlos.**
   - **Lógica pura** (parseo de fechas, `resolverDestinoCalendario`, `normalizarCorreoHablado`, `esCorreoValido`, etc.): si el cambio es sustancial, verifícala aparte con Node en local antes de subirla (es JS normal, clasp no lo impide). Ver "Testing mínimo" en `tasks.md`.
   - **Código acoplado a Sheets/Calendar/Tasks/WhatsApp:** no hay mocks configurados. Sube el cambio con `npx clasp push` **contra el entorno de dev** (nunca contra el proyecto de producción que atiende el WhatsApp real de Héctor/Angy — ver sección 6 del README) y corre manualmente las funciones `test_*()` correspondientes desde el editor de Apps Script. Si el entorno de dev todavía no existe, dilo explícitamente antes de desplegar cualquier cambio no trivial, en vez de probar contra producción.
   - **CRÍTICO — `clasp push` NO es suficiente para que WhatsApp vea el cambio.** Solo actualiza el editor (HEAD). El webhook real usa un despliegue de Web App con versión FIJA (`npx clasp deployments` para verlo — el que no dice `@HEAD`). Después de cada `clasp push` que deba quedar visible por WhatsApp, corre también `npx clasp deploy -i <ese-deployment-id> -d "descripción"` para publicar una versión nueva a ESE despliegue (nunca `clasp deploy` sin `-i`, eso crea uno nuevo con otra URL). Ver sección 8 del README — este paso se nos olvidó una sesión completa y causó horas de "fixes" que nunca llegaron a producción.
   - Nunca reportes "pruebas ejecutadas" si no corriste nada — si no hay test automatizado para lo que tocaste, dilo explícitamente en el reporte de entrega.

---

## 3. Control de Calidad y Criterios de Aceptación
- **Sin código destructivo:** No elimines funcionalidades ni modifiques la estructura de la base de datos o APIs públicas sin asegurarte de no romper compatibilidad con otros módulos.
- **Gestión de Errores:** Maneja siempre casos borde (edge cases), entradas nulas, fallos de red o de autenticación/autorización.
- **Rendimiento:** Apps Script tiene cuotas por ejecución — evita llamadas redundantes a `SpreadsheetApp.openById()`/`getDataRange()` dentro de un mismo flujo (cachea en variables locales o usa `getSS()`/`getSheet()` si ya existen — ver deuda técnica en `architecture.md`), y evita loops que llamen a APIs externas (Calendar, WhatsApp, OpenAI) por cada fila cuando se puede batchear.

---

## 4. Seguridad y Buenas Prácticas
- **Credenciales:** NUNCA escribas claves API, tokens, contraseñas o secretos directamente en el código fuente ni en archivos versionados. Este proyecto no usa `.env` — los secretos (`OPENAI_API_KEY`, `WHATSAPP_TOKEN`) viven en *Script Properties* de cada proyecto de Apps Script (Configuración del proyecto → Propiedades del script), separadas entre dev y prod.
- **Sanitización:** Sanitiza y normaliza cualquier dato que venga de WhatsApp (texto dictado, correos, teléfonos) antes de usarlo — ver `normalizarCorreoHablado`/`esCorreoValido` en `Sesiones.gs` como patrón existente. No hay SQL en este proyecto (la "base de datos" es Google Sheets), pero sí valida tipos antes de comparar (ver el bug conocido de `sender_phone` en `tasks.md`).
- **Reglas de Git:** Trabaja respetando la rama actual. No ejecutes comandos destructivos de Git (`git reset --hard`, `git push --force`) a menos que se te indique explícitamente.

---

## 5. Formato del Reporte de Entrega
Cuando completes todo el ciclo y las pruebas hayan pasado con éxito, presenta un resumen ejecutivo listo para mi revisión:

- **Resumen:** Explicación breve de los cambios realizados.
- **Archivos Modificados/Creados:** Lista con los puntos clave ajustados.
- **Pruebas Ejecutadas:** Resultado de las pruebas (por ejemplo, `PASS: 12 tests ejecutados, 0 fallos`).
- **Puntos a Revisar:** Breve llamada de atención sobre cualquier decisión de diseño o posible optimización futura que deba supervisar.