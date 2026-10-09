# Validación de UpKeepHR 1.2.0

Los datos de pruebas son ficticios y se ejecutan exclusivamente en hhrr_test o PostgreSQL efímero de CI. No se distribuyen expedientes, importaciones ni anexos de producción.

Cobertura automatizada:

- Calendario y aniversarios bisiestos; Ley 300 con entrega inicial, tres verificaciones posteriores y renovación completa.
- Entrega, rechazo, corrección, aprobación y pausa de avisos durante revisión.
- Aislamiento de expedientes y archivos, cuentas, activación, MFA y protección del último superadmin.
- Reglas versionadas, asignaciones, dashboard y reportes consistentes; Sin datos cuando no existen requisitos.
- Motor concurrente, recuperación, reintentos, idempotencia y correo deshabilitado.
- Limpieza de empleados: conserva catálogo y acceso administrativo, elimina datos derivados, bloquea operaciones durante mantenimiento y permite repetición sin duplicados.
- Respaldos con formato UPKEEPHR-PG-1, exportaciones Excel y comprobantes PDF con identidad UpKeepHR.

Comandos: npm run typecheck, npm run lint, npm test, npm run build. El recorrido HTTP y de navegador se ejecuta con datos ficticios y configuración aislada. RLS, privilegios y buckets privados se verifican por separado en producción con scripts/audit-security.ts.

El ZIP se genera desde el árbol actual de Git, sin historial ni secretos, y se inspecciona para excluir referencias de marca anteriores, dependencias, resultados de pruebas y datos privados.
