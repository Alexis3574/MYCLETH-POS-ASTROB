INSERT INTO pos.permiso (
    codigo,
    modulo,
    descripcion
)
VALUES (
    'VENTAS.DEVOLVER',
    'VENTAS',
    'Registrar devoluciones de ventas'
)
ON CONFLICT (codigo)
DO UPDATE SET
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion;