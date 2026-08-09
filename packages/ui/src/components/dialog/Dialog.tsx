import type { DialogHTMLAttributes } from 'react';

export function Dialog({ children, ...props }: DialogHTMLAttributes<HTMLDialogElement>) {
  return <dialog {...props}>{children}</dialog>;
}
