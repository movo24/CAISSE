import { Outlet, NavLink } from 'react-router-dom';
import { Home, CreditCard, Sparkles, User } from 'lucide-react';

export function App() {
  return (
    <>
      <Outlet />
      <nav className="tab-bar">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}
        >
          <Home size={22} />
          <span>Accueil</span>
        </NavLink>
        <NavLink
          to="/card"
          className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}
        >
          <CreditCard size={22} />
          <span>Carte</span>
        </NavLink>
        <NavLink
          to="/rewards"
          className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}
        >
          <Sparkles size={22} />
          <span>Avantages</span>
        </NavLink>
        <NavLink
          to="/profile"
          className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}
        >
          <User size={22} />
          <span>Profil</span>
        </NavLink>
      </nav>
    </>
  );
}
