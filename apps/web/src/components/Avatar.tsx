import { pickColor } from '@webcode/shared';

type Props = { userId?: string | null; name: string; size?: number };

export function Avatar({ userId, name, size = 28 }: Props) {
  const style = { width: size, height: size, fontSize: size * 0.43 };
  if (userId) {
    return (
      <img className="avatar" style={style} src={`/api/avatar/${encodeURIComponent(userId)}`} alt={name} />
    );
  }
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span className="avatar avatar-initial" style={{ ...style, background: pickColor(name) }} title={name}>
      {initial}
    </span>
  );
}
