# Contribuir a UpKeepHR

Las mejoras, correcciones y propuestas son bienvenidas. Describe el problema y los pasos para reproducirlo usando únicamente datos ficticios.

- No publiques expedientes, documentos, correos reales, secretos ni respaldos.
- Mantén las comprobaciones de autorización en el servidor.
- No cambies migraciones ya aplicadas: añade una nueva migración.
- Usa exclusivamente bases de datos aisladas de pruebas y el esquema `hhrr_test` para los tests.
- Antes de proponer cambios, ejecuta `npm run typecheck`, `npm run lint`, `npm test` y `npm run build` siguiendo la configuración de CI.
- Los cambios de requisitos documentales deben explicar su alcance y no afirmar que garantizan cumplimiento legal.

Para problemas de seguridad, no publiques detalles explotables o datos sensibles en un issue. Usa el aviso privado de seguridad de GitHub, si está habilitado.
