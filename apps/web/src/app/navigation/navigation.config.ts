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
        permission: 'PRODUCTOS.VER',
      },
      {
        id: 'inventory',
        label: 'Inventario',
        icon: '◫',
        permission: 'INVENTARIO.VER',
      },
      {
        id: 'customers',
        label: 'Clientes',
        icon: '◎',
        permission: 'CLIENTES.VER',
      },
      {
        id: 'purchases',
        label: 'Compras',
        icon: '◈',
        permission: 'COMPRAS.VER',
      },
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
        permission: 'USUARIOS.VER',
      },
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
