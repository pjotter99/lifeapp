// Vorlaeufig: einfache Links, bis eine echte Tab-Leiste kommt. Volle
// Seitenladung beim Wechsel ist hier bewusst in Kauf genommen — kein Router.
const LINKS = [
  { href: '/erfassen', label: 'Erfassen' },
  { href: '/stammdaten', label: 'Stammdaten' },
];

export function TopNav() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';

  return (
    <nav className="flex gap-4 border-b border-border pb-4 text-sm">
      {LINKS.map((link) => {
        const active = path === link.href || (link.href === '/erfassen' && path === '/');
        return (
          <a key={link.href} href={link.href} className={active ? 'font-semibold text-text' : 'text-text-dim'}>
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
