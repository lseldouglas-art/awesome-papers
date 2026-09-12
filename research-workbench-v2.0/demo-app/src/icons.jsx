const paths = {
  leaf: <><path d="M20 3C8 1 2 8 6 16s16 1 14-13Z"/><path d="m4 21 12-13M9 13l1 4M13 9l4 1"/></>,
  edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15v5Z"/><path d="M11 4H5a3 3 0 0 0-3 3v13a2 2 0 0 0 2 2h13a3 3 0 0 0 3-3v-6"/></>,
  folder: <path d="M3 6V4h6l2 3h10v13H3V6Zm0 4h18"/>,
  book: <><path d="M5 3h14v18H5a2 2 0 0 1 0-4h14M5 3a2 2 0 0 0-2 2v14M8 6v7"/></>,
  outline: <path d="M4 5h16M4 10h12M4 15h16M4 20h12"/>,
  comment: <path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4H3a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2Zm3 5h10M7 12h7"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  chevron: <path d="m14 6-6 6 6 6"/>,
  arrow: <path d="M12 20V4m-6 6 6-6 6 6"/>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  link: <><path d="m10 8 3-3a5 5 0 0 1 7 7l-3 3M14 16l-3 3a5 5 0 0 1-7-7l3-3m1 6 8-8"/></>,
  user: <><circle cx="12" cy="7" r="4"/><path d="M3 22v-4a9 9 0 0 1 18 0v4H3Z"/></>,
  chart: <path d="M3 14h4v7H3Zm7-6h4v13h-4Zm7-6h4v19h-4Z"/>,
  plus: <path d="M12 4v16M4 12h16"/>,
  return: <path d="m8 5-5 5 5 5M3 10h10a7 7 0 0 1 7 7v3"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></>,
};
export function Icon({ name, size = 19 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.book}</svg>; }
export function IconButton({ name, label, children, ...props }) { return <button className="icon-button" title={label} aria-label={label} {...props}><Icon name={name}/>{children}</button>; }
