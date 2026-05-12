import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import PaperTradingDisclaimer from './PaperTradingDisclaimer';

export default function Layout() {
  return (
    <>
      <PaperTradingDisclaimer />
      <Sidebar />
      <div className="main-content" style={{ background: 'rgb(2, 6, 23)' }}>
        <Outlet />
      </div>
    </>
  );
}
