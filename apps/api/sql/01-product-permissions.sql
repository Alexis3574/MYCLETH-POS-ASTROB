-- Crea los permisos sin asignarlos automáticamente a ningún rol.
BEGIN;
INSERT INTO permiso (codigo, modulo, descripcion) VALUES
  ('PRODUCTOS.VER', 'PRODUCTOS', 'Consultar productos, categorías, unidades e impuestos'),
  ('PRODUCTOS.CREAR', 'PRODUCTOS', 'Registrar productos'),
  ('PRODUCTOS.EDITAR', 'PRODUCTOS', 'Editar información del producto'),
  ('PRODUCTOS.CAMBIAR_ESTADO', 'PRODUCTOS', 'Activar y desactivar productos')
ON CONFLICT (codigo) DO NOTHING;
COMMIT;

SELECT id, codigo, modulo FROM permiso WHERE modulo = 'PRODUCTOS' ORDER BY codigo;
