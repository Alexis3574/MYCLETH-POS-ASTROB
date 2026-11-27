export interface NavigationItem {
  id: string
  label: string
  icon: string
  to?: string
  permission?: string
}

export interface NavigationSection {
  id: string
  label: string
  items: NavigationItem[]
}

export const navigationSections: NavigationSection[] = [
  {
    id: 'general',
    label: 'GENERAL',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: '▦',
        to: '/dashboard',
      },
    ],
  },
  {
    id: 'operations',
    label: 'OPERACIONES',
    items: [
      {
        id: 'pos',
        label: 'Punto de venta',
        icon: '▤',
        to: '/pos',
        permission: 'VENTAS.CREAR',
      },
      {
        id: 'sales',
        label: 'Ventas',
        icon: '▤',
        to: '/sales',
        permission: 'VENTAS.VER',
      },
      {
        id: 'products',
        label: 'Productos',
        icon: '▣',
        to: '/products',
        permission: 'PRODUCTOS.VER',
      },
      {
        id: 'inventory',
        label: 'Inventario',
        icon: '◫',
        to: '/inventory',
        permission: 'INVENTARIO.VER',
      },
      {
        id: 'customers',
        label: 'Clientes',
        icon: '◎',
        to: '/customers',
        permission: 'CLIENTES.VER',
      },
      {
        id: 'cash',
        label: 'Caja',
        icon: '◫',
        to: '/cash',
        permission: 'CAJAS.VER',
      },
      {
        id: 'purchases',
        label: 'Compras',
        icon: '◈',
        to: '/purchases',
        permission: 'COMPRAS.VER',
      },
      {
        id: 'suppliers',
        label: 'Proveedores',
        icon: '◎',
        to: '/suppliers',
        permission: 'PROVEEDORES.VER',
      },
      { id: 'quotes', label: 'Cotizaciones', icon: '▤', to: '/quotes', permission: 'COTIZACIONES.VER' },
      { id: 'orders', label: 'Órdenes de venta', icon: '▤', to: '/sales-orders', permission: 'ORDENES.VER' },
      { id: 'customer-orders', label: 'Pedidos', icon: '▤', to: '/customer-orders', permission: 'PEDIDOS.VER' },
      { id: 'credits', label: 'Ventas a crédito', icon: '◫', to: '/credits', permission: 'VENTAS.VER' },
    ],
  },
  {
    id: 'administration',
    label: 'ADMINISTRACIÓN',
    items: [
      {
        id: 'users',
        label: 'Usuarios',
        icon: '♙',
        to: '/users',
        permission: 'USUARIOS.VER',
      },
      { id: 'roles', label: 'Roles', icon: '♙', to: '/roles', permission: 'USUARIOS.VER' },
      { id: 'permissions', label: 'Permisos', icon: '♙', to: '/permissions', permission: 'USUARIOS.VER' },
    ],
  },
]

export function getVisibleNavigationSections(
  permissionCodes: readonly string[],
): NavigationSection[] {
  const grantedPermissions = new Set(permissionCodes)

  return navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          !item.permission ||
          grantedPermissions.has(item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0)
}
