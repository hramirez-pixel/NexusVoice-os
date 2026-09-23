# NexusVoice OS

Asistente de WhatsApp que transcribe notas de voz (Whisper), clasifica la intención
(GPT-4o-mini) y crea/consulta citas en Google Calendar y tareas en Google Tasks,
con seguimiento en una base de datos en Google Sheets.

## Estructura del proyecto

```
nexusvoice-os/
├── src/                     # Todo lo que clasp sube al editor de Apps Script
│   ├── appsscript.json      # Manifiesto (zona horaria, servicios avanzados)
│   ├── Config.gs            # CONFIG, alias de destino, perfiles de usuario
│   ├── Webhook.gs           # doGet / doPost — entrada de WhatsApp
│   ├── Pipeline.gs          # processIncomingAudio, processTextCommand, handleTextMessage
│   ├── Classifier.gs        # Prompt y llamada a OpenAI para clasificar el mensaje
│   ├── Catalogo.gs          # Resolución de nombres -> IDs de calendario/lista
│   ├── CalendarService.gs   # Crear eventos, parseo de fecha/hora
│   ├── TasksService.gs      # Crear tareas, resolución de listas de tareas
│   ├── Sesiones.gs          # Hoja "Sesiones": IDs cortos, invitados, búsquedas
│   ├── NotasPendientes.gs   # Notas ambiguas sin resolver
│   ├── Ayuda.gs             # Mensaje de ayuda para el usuario final
│   ├── WhatsAppApi.gs       # Descarga de audio, transcripción, envío de mensajes
│   ├── Logging.gs           # Auditoria_Logs
│   ├── Email.gs             # Envío de correo (resumen diario, respaldo)
│   └── Triggers.gs          # Resumen diario, recordatorio de notas, tip de uso
├── .clasp.json.example      # Plantilla — copiar a .clasp.json con tu Script ID real
├── .claspignore              # Qué sube clasp al editor (solo src/)
├── .gitignore
├── package.json
└── README.md
```

> **Por qué está dividido así:** Apps Script junta todos los `.gs` en un mismo
> namespace global al ejecutarse — no existe `import`/`export`. Dividir en archivos
> es puramente organizativo (para git y para tu cordura), no cambia el comportamiento.

## 1. Requisitos

- Node.js instalado (para `npm` y `clasp`).
- Una cuenta de Google con acceso al proyecto de Apps Script existente
  (o permiso para crear uno nuevo).

## 2. Instalación local

```bash
git clone <URL-DE-TU-REPO>   # o: cd a esta carpeta si ya la tienes local
cd nexusvoice-os
npm install                  # instala clasp como dependencia local
npx clasp login               # abre el navegador, inicia sesión con tu cuenta Google
```

`clasp login` guarda un token en `~/.clasprc.json` — **nunca** se sube a git
(ya está en `.gitignore`).

## 3. Conectar con tu proyecto de Apps Script existente

Tu script ya existe (tiene un Script ID). Dos formas de obtenerlo:
- Abre el proyecto en script.google.com → ⚙️ Configuración del proyecto → copia el "ID del script".
- O, si aún no tienes el código en Apps Script y quieres crearlo desde cero:
  `npx clasp create --type webapp --title "NexusVoice OS" --rootDir src`

Con el ID en mano:

```bash
cp .clasp.json.example .clasp.json
# edita .clasp.json y pega tu scriptId real
```

`.clasp.json` **no se versiona** (cada entorno dev/prod tiene el suyo — ver sección 6).

## 4. Traer lo que ya está en el editor (por si acaso difiere de este split)

```bash
npx clasp pull
```

Esto sobrescribe `src/` con lo que hay en el editor ahora mismo. Como ya hicimos el
split manualmente a partir de tu código actual, probablemente **no** lo necesites la
primera vez — pero es la forma correcta de sincronizar si alguien edita directo en
el navegador y tú no jalaste esos cambios.

## 5. Subir cambios (tu día a día)

```bash
git add .
git commit -m "descripción del cambio"
git push                      # a tu repo (GitHub, GitLab, etc.)

npx clasp push                # sube src/ al editor de Apps Script
```

`git` versiona tu historial; `clasp push` es lo que realmente actualiza el código
que corre. Son pasos independientes — hacer commit no despliega nada, y viceversa.

Tip: `npx clasp push --watch` deja corriendo un watcher que sube automáticamente
cada vez que guardas un archivo, útil mientras depuras.

## 6. Entornos separados: dev vs. producción (recomendado)

Ahora mismo un solo script atiende tu número de WhatsApp real. Para poder probar
cambios sin arriesgar mensajes reales a Héctor/Angy:

1. Crea un **segundo** proyecto de Apps Script + una **segunda** copia del Google
   Sheet (o una hoja de prueba) + idealmente un número de prueba de WhatsApp
   (Meta te da uno gratis en modo desarrollo).
2. Guarda dos configuraciones de clasp:
   ```
   .clasp.dev.json    (scriptId del proyecto de pruebas)
   .clasp.prod.json   (scriptId del proyecto real)
   ```
3. Para apuntar a uno u otro: `cp .clasp.dev.json .clasp.json && npx clasp push`.

Así puedes probar un cambio en `Classifier.gs` (por ejemplo) contra el entorno de
pruebas antes de tocar el que usan Héctor y Angy todos los días.

## 7. Dónde van los secretos

Las API keys (`OPENAI_API_KEY`, `WHATSAPP_TOKEN`) **no van en el código ni en git**.
Viven en *Script Properties* de cada proyecto de Apps Script (Configuración del
proyecto → Propiedades del script), como ya lo tenías. Al tener dos entornos
(dev/prod), cada uno tiene sus propias Script Properties — puedes usar el token de
prueba de WhatsApp en dev y el real solo en prod.

## 8. Desplegar como Web App (para que el webhook de WhatsApp funcione)

> **CRÍTICO — `clasp push` NO ACTUALIZA LO QUE WHATSAPP EJECUTA.** `clasp push`
> solo sube tu código al *editor* de Apps Script (a la versión "HEAD"). Si el
> webhook de WhatsApp en Meta apunta a un despliegue de Web App con una
> versión **fija** (lo normal en producción, no "HEAD"), ese despliegue queda
> **congelado en la versión que tenía** hasta que corras `clasp deploy`
> explícitamente. Es fácil pasar horas "arreglando" algo con `clasp push` y
> probando por WhatsApp sin ver ningún cambio, porque el webhook real sigue
> sirviendo la versión vieja. Para confirmar qué versión sirve el webhook:
> `npx clasp deployments` — vas a ver algo como:
> ```
> - AKfycbx...@HEAD                (no es la de producción normalmente)
> - AKfycbz...@32 - <descripción>  (esta es la que probablemente usa Meta)
> ```

Para publicar un cambio de verdad (que WhatsApp lo use), actualiza el
despliegue existente **por su ID**, nunca corras `clasp deploy` a secas (eso
crea un despliegue NUEVO, con una URL nueva, que Meta no conoce):

```bash
npx clasp deployments                          # copia el ID @32 (o el que no sea @HEAD)
npx clasp deploy -i <ESE-ID> -d "v3.15 - <resumen del cambio>"
```

Esto crea una nueva versión (ej. 32 → 33) **dentro del mismo despliegue**, así
que la URL del webhook (`/exec`) no cambia y no hay que tocar nada en Meta
Business Suite. Solo se crea un despliegue nuevo (URL nueva) si corres
`clasp deploy` sin `-i`, o si nunca has desplegado antes.

## Notas conocidas / pendientes

- `sender_phone` en la hoja `Sesiones` a veces se guarda como número
  (`5214431025894`) en vez de texto. Las comparaciones contra
  `CONFIG.USUARIOS` (claves string) deben normalizar con `.toString()`
  para evitar fallos silenciosos — mismo patrón que el fix de fechas de v3.14.
- `CONFIG.USUARIOS` sigue hardcodeado en `Config.gs`. Para agregar gente sin
  redesplegar, el siguiente paso natural es moverlo a una pestaña `Usuarios`
  en el Sheet, igual que `Catalogo_Listas`.
