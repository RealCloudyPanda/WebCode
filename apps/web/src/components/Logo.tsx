export function Logo({ size = 1 }: { size?: number }) {
  return (
    <span className="logo-wrap" style={{ fontSize: `${20 * size}px` }}>
      <span className="logo-mark" aria-hidden="true">{'</>'}</span>
      <span className="logo-name">Webcode</span>
    </span>
  );
}
