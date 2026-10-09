# UpKeepHR

Plataforma de documentación y seguimiento de requisitos de Recursos Humanos en español, pensada para entornos **Head Start y Early Head Start**, con contexto operativo de Puerto Rico. Publicada para que otras organizaciones puedan estudiar el proyecto, adaptarlo y aprovecharlo en sus propios procesos.

Next.js 16, React 19, TypeScript, Prisma 7, PostgreSQL/Supabase y Vercel.

## Propósito y alcance

UpKeepHR ayuda a organizar expedientes del personal, requisitos documentales, entregas, revisiones, vencimientos, recordatorios y reportes. Incluye acceso diferenciado para superadministración, RH, supervisoras y empleados.

- Está orientado al seguimiento documental del **personal**, no a expedientes de niños o familias.
- Las plantillas y reglas iniciales deben revisarse según la jurisdicción, los puestos y las políticas de cada organización.
- No es un producto oficial ni está afiliado, aprobado o certificado por Head Start, Early Head Start, la Office of Head Start o una agencia gubernamental.
- No constituye asesoría legal ni garantiza cumplimiento normativo. La organización sigue siendo responsable de validar requisitos, evidencias y decisiones.

## Privacidad antes de usarlo

Este repositorio distribuye código y ejemplos de configuración; no incluye expedientes reales, archivos de empleados, bases de datos ni credenciales de producción. Los ejemplos de pruebas y demostración son sintéticos.

Utiliza infraestructura propia, mantén los secretos fuera de Git y configura controles de acceso, retención y recuperación antes de cargar información real. Nunca adjuntes documentos personales, enlaces de activación, respaldos o tokens a issues o pull requests públicos. No se ha realizado una certificación independiente de seguridad.

## Obtener el proyecto

```bash
git clone https://github.com/ooovenenoso/UpKeepHR.git
cd UpKeepHR
npm ci
```

El código público no incluye un servicio alojado ni infraestructura gratuita. Cada instalación requiere su propia configuración de PostgreSQL/Supabase y, si corresponde, Vercel y correo. Consulta los pasos siguientes antes de ejecutar comandos de aprovisionamiento.

## Licencia

Publicado bajo la [licencia Apache 2.0](LICENSE). Puedes usar, modificar y redistribuir el proyecto, incluso para fines comerciales, cumpliendo sus condiciones de atribución y avisos. Se distribuye sin garantías. La licencia no concede derechos sobre marcas de terceros ni implica aval institucional. Consulta también [NOTICE](NOTICE).

## Instalación

Requiere Node.js 24 y npm. La distribución contiene únicamente el proyecto, sin datos de empleados ni credenciales.

1. Clonar el repositorio o extraer la distribución y ejecutar `npm ci`.
2. Preparar un archivo privado de configuración fuera del repositorio usando .env.example. En .env.local indicar APP_ENV_FILE con su ruta absoluta.
3. Para el flujo automatizado de infraestructura, aprovisionar exclusivamente las tablas hhrr_ y los cuatro buckets privados con `npm run provision`. Las credenciales administrativas se leen desde `../.env`; configurar SUPABASE_PROJECT_REF, VERCEL_TEAM_ID, GITHUB_REPOSITORY y PRODUCTION_APP_URL. **Este script también crea/configura un repositorio privado y un proyecto Vercel: GITHUB_REPOSITORY debe apuntar a un repositorio propio y privado para la instalación, no a este repositorio público.** Requiere los tokens administrativos de los proveedores. Revisar el script antes de ejecutarlo; no reutilizar un proyecto compartido sin revisar sus objetos existentes.
4. Ejecutar npm run setup: genera Prisma, comprueba la conexión e instala siete plantillas. No crea empleados en producción.
5. Ejecutar npm run bootstrap para generar el enlace privado inicial del superadmin. El enlace se guarda fuera del repositorio, en %LOCALAPPDATA%/UpKeepHR/cloud/activar-superadmin.html; vence en 24 horas. No subirlo a GitHub.
6. Ejecutar npm run dev para servidor y motor local, o npm run build y npm run start:local. En Vercel el cron protegido invoca /api/cron cada minuto.

UPKEEPHR_CONFIG_DIR permite cambiar la carpeta privada de configuración. Desarrollo y pruebas utilizan hhrr_test; producción utiliza public. Los secretos nunca se incluyen en el ZIP. npm run deploy utiliza el proyecto y repositorio guardados por provision.

## Usuarios y expedientes

Superadmin administra usuarios RH y otros superadministradores. El último superadmin activo está protegido. RH crea empleados, asigna supervisoras y requisitos, habilita cuentas y aprueba o rechaza entregas. Un empleado ve su expediente; una supervisora consulta estados de su equipo. Los administradores pueden existir sin expediente o CPID.

Acceso por CPID o correo y contraseña, activación de un solo uso y MFA obligatorio para superadmin/RH. Los originales se descargan mediante rutas autenticadas y enlaces privados breves.

## Reglas y automatización

- Plazo inicial de 30 días calendario, editable por documento o empleado.
- Documentos sin vencimiento, con fecha registrada o vigencia desde la emisión. Reglas versionadas y vista previa antes de aplicar cambios a obligaciones existentes.
- Ley 300: verificación inicial de antecedentes junto al documento base, tres posteriores en los años 2–4 y renovación completa en el vencimiento registrado. El aniversario del 29 de febrero pasa al 1 de marzo en años no bisiestos.
- Entregas en revisión, aprobadas o rechazadas. El cumplimiento actual se calcula aparte; durante la revisión se pausan recordatorios al empleado.
- PDF, JPG y PNG: hasta cinco archivos de 10 MB, validación real de tipo, tamaño y checksum en el servidor.
- Avisos a 10/5/0 días y cada siete días después; resumen diario por empleado, resumen de supervisoras y reporte semanal para RH. Horario de Puerto Rico: 08:00–18:00.
- Motor con exclusión persistente, trabajos idempotentes, recuperación tras reinicio y respaldos reanudables.

El correo real permanece deshabilitado: EMAIL_ENABLED=false y EMAIL_PROVIDER=disabled. Configurar Resend y el remitente antes de habilitarlo explícitamente.

## Dashboard y reportes

Resumen de cumplimiento actual, documentos vencidos, verificaciones atrasadas, entregas en revisión, sedes, responsables y evolución diaria. Las tarjetas muestran Sin datos cuando no hay requisitos. El panel se actualiza tras acciones y cada 15 segundos mientras está visible.

Reportes de resumen ejecutivo, cumplimiento, vencimientos de 7/30/60/90 días, carga de RH, ciclos Ley 300, historial, auditoría y motor. PDF y Excel incluyen únicamente la marca UpKeepHR, fecha y filtros. La sección Estado actual del expediente se distingue de las entregas pendientes y del historial cerrado.

La importación está deshabilitada en pantallas y API. Los nuevos empleados se crean desde RH.

## Seguridad y datos

Todas las tablas de la aplicación tienen prefijo hhrr_. RLS y privilegios restringen el acceso directo de anon/authenticated. El rol hhrr_app no puede consultar otros proyectos ni saltar RLS. Los permisos por rol y expediente se comprueban en el servidor.

Buckets privados: hhrr-documents, hhrr-uploads, hhrr-reports y hhrr-backups. TLS valida el certificado de Supabase usando la CA pública incluida. Las migraciones aplicadas en prisma/cloud son inmutables y tienen hashes. No ejecutar prisma db push, migrate reset o migraciones genéricas sobre un proyecto compartido.

La limpieza administrativa se ejecuta únicamente por CLI: npm run clear:employees -- --project PROJECT_REF ofrece una vista previa; añadir --execute realiza el borrado expresamente solicitado. Conserva cuentas RH/superadmin, contraseñas, MFA y catálogo; elimina expedientes y datos derivados, incluyendo importaciones, exportaciones, avisos y objetos de los cuatro buckets RH. Bloquea temporalmente las operaciones y el motor. Un fallo parcial mantiene el mantenimiento hasta repetir el comando. No ejecutar el servidor de pruebas mientras se purgan esos buckets compartidos por la aplicación.

## Verificación

npm run typecheck, npm run lint, npm test y npm run build.

Los tests rechazan cualquier esquema distinto de hhrr_test. Cubren calendario, ciclos, entregas, permisos, versiones, idempotencia, usuarios, MFA y limpieza con conservación de acceso administrativo. GitHub Actions usa PostgreSQL efímero sin datos reales. npm run test:http verifica el recorrido con servidor local y Storage privado.

Más detalles: [Operación](docs/operacion.md), [Marca](docs/brand-assets.md) y [Validación](docs/validacion.md).

El ZIP excluye .git, secretos, bases de datos, documentos de empleados, respaldos, cookies, resultados de pruebas, node_modules y .next.
