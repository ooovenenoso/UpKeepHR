# Operación y recomendaciones

1. Activar el primer superadmin con el enlace privado generado por `npm run bootstrap`. Configurar una autenticadora y guardar los códigos de recuperación fuera del equipo.
2. Crear al menos un segundo superadmin para continuidad. El sistema impide desactivar o degradar al último superadmin activo.
3. Crear usuarios de RH desde **Usuarios y acceso**. RH administra todos los expedientes de la organización; puede crear y editar empleados, supervisoras y asignaciones.
4. Crear el expediente antes de habilitar una cuenta de empleado/supervisora. El CPID identifica el expediente; el correo identifica la cuenta. Entregar directamente el enlace privado de activación, válido por 24 horas y un solo uso.
5. Revisar la plantilla de cada documento antes de asignarla. Los valores iniciales son editables; no sustituyen la validación de RH ni una decisión legal. La emisión original de Ley 300 requiere verificación.
6. Distribuir entregas entre responsables y atender las que superen 48 horas. La asignación de revisión organiza el trabajo; cualquier usuario RH autorizado puede aprobar o rechazar.
7. La migración ya está cerrada. Crear los nuevos empleados desde RH. Consultar Ley 300 en el expediente o su reporte: se muestran el año, la verificación inicial junto con Ley 300, las verificaciones de los años 2, 3 y 4 y la renovación completa en el vencimiento registrado. RH confirma el paquete Ley 300 + antecedentes al aprobar una certificación nueva. Los ciclos derivados de fórmulas son estimados hasta cotejar la emisión original y las entregas históricas con sus evidencias.
8. Revisar **Notificaciones** para última ejecución, pendientes, fallos y respaldos. Vercel ejecuta `/api/cron` cada minuto con `CRON_SECRET`; una exclusión persistente evita dos ejecuciones simultáneas.

## Correo

La configuración entregada tiene `EMAIL_ENABLED=false` y `EMAIL_PROVIDER=disabled`. No se instala el token Resend en Vercel. Las notificaciones se conservan dentro del portal con estado **Correo deshabilitado**; no representan envíos aceptados por un proveedor. Las aprobaciones y rechazos generan notificaciones inmediatamente, los recordatorios respetan Puerto Rico 08:00–18:00, incluyendo fines de semana.

Para una etapa futura con correo real: validar remitente y dominio de Resend, registrar SPF/DKIM/DMARC, comprobar direcciones y habilitar explícitamente `EMAIL_ENABLED=true`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` y `RESEND_WEBHOOK_SECRET`. Configurar el webhook autenticado y comprobar aceptación/entrega/rebote. Los envíos ambiguos de más de 24 horas quedan pendientes de comprobación. No habilitar esos cambios como parte de esta versión.

## Respaldos y recuperación

La conexión del servidor con Supabase usa TLS y verifica el certificado y el nombre del servidor mediante la CA oficial incluida en `certs/supabase-ca.crt`. El certificado es público, no contiene una clave privada y puede versionarse. Su actualización futura debe verificarse contra el proveedor. No se modifica la configuración SSL global del proyecto compartido.

El motor toma un snapshot lógico de las 28 tablas RH en una transacción PostgreSQL `REPEATABLE READ`. El manifiesto y la base se guardan en `hhrr-backups`; los originales inmutables se copian en lotes de cinco archivos por ejecución. Una copia interrumpida continúa en el siguiente ciclo. `lastBackup` se actualiza cuando termina todo el respaldo. Un administrador puede iniciar otro desde el panel.

Conservar por separado `BETTER_AUTH_SECRET`: cifra los secretos MFA y no se incluye en Git, ZIP ni respaldos. No cambiarlo sin una estrategia de recuperación. Los respaldos contienen datos personales y credenciales cifradas/hash, por lo que el bucket permanece privado. Las URLs de descarga duran 60 segundos y se emiten tras comprobar permisos.

Para comprobar un respaldo sin tocar producción, ejecutar `npm run restore:test -- --manifest <ruta-del-manifiesto>` con la configuración del esquema `hhrr_test`. La herramienta rechaza cualquier otro esquema y restaura únicamente tablas `hhrr_` dentro del esquema de pruebas. Detener el servidor de pruebas y sus tests durante la restauración. No restaurar el proyecto compartido completo; primero validar en el esquema de pruebas y preparar una ventana operativa para cualquier recuperación real.

Recomendación siguiente: acordar una política de retención de expedientes, exportaciones y respaldos, descargar periódicamente una copia cifrada a otra ubicación y hacer simulacros de recuperación. La versión actual conserva originales e historial; no aplica borrados por antigüedad.

## Límites actuales

- Las vistas muestran hasta 500 filas de un reporte; la exportación incluye todas las filas. Auditoría y motor muestran los últimos 1,000 registros y son globales.
- El historial diario empieza al activar el motor. Los períodos anteriores no se reconstruyen como estadísticas observadas.
- Los enlaces de carga directa duran hasta dos horas y admiten cinco archivos de 10 MB cada uno. PNG/JPEG se decodifican y PDF se valida antes de registrar la entrega. Los documentos no pasan por un antivirus externo en esta versión; los archivos se descargan como adjuntos privados.
- El esquema `hhrr_test` y los cuatro buckets están en el proyecto compartido, pero los datos de prueba se mantienen separados de las tablas de producción. Los tokens de administración no forman parte del runtime desplegado.
