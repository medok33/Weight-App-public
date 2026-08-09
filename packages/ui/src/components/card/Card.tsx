import type { HTMLAttributes } from 'react';

export function Card({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props}>{children}</div>;
}
