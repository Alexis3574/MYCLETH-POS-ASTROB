import SupplierBrowser from '../features/suppliers/SupplierBrowser'
import './SalesPage.css'
import './CommercialPage.css'
import '../features/purchases/purchases.css'
export default function SuppliersPage() {
  return <section className="commercial-page"><header className="sales-heading"><div><p className="sales-eyebrow">ABASTECIMIENTO</p><h1>Proveedores</h1><p>Consulta datos, contactos, condiciones y domicilios.</p></div></header><SupplierBrowser /></section>
}
