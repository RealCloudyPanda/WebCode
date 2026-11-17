type Props = {
  tabs: string[];
  active: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
};

export function EditorTabs({ tabs, active, onSelect, onClose }: Props) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((p) => (
        <div key={p} className={`tab${p === active ? ' on' : ''}`} role="presentation">
          <button role="tab" aria-selected={p === active} className="tab-label" onClick={() => onSelect(p)}>
            {p.slice(p.lastIndexOf('/') + 1)}
          </button>
          <button className="tab-close" aria-label={`Close ${p}`} onClick={() => onClose(p)}>×</button>
        </div>
      ))}
    </div>
  );
}
