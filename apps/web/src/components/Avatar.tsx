import { useState } from 'react';
import { pickColor } from '@webcode/shared';

type Props = { userId?: string | null; name: string; size?: number };

export function Avatar({ userId, name, size = 28 }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.43 };
  if (userId && !imageFailed) {
    return (
      <img
        className="avatar"
        style={style}
        src={`/api/avatar/${encodeURIComponent(userId)}`}
        alt={name}
        onError={() => setImageFailed(true)}
      />
    );
  }
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span className="avatar avatar-initial" style={{ ...style, background: pickColor(name) }} title={name}>
      {initial}
    </span>
  );
}
