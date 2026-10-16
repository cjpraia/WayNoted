// Botão e botão de ícone compartilhados (estilos em controls.css). Use no lugar de variantes locais (st-btn, ot-btn, ai-btn…).
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'secondary' | 'primary' | 'ghost' | 'danger' | 'danger-quiet'

export const buttonClass = (variant: ButtonVariant = 'secondary', extra = '') =>
  `np-btn${variant === 'secondary' ? '' : ` np-btn--${variant}`}${extra ? ` ${extra}` : ''}`

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }>(
  function Button({ variant = 'secondary', className, type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} className={buttonClass(variant, className)} {...rest} />
  })

/** Botão só com ícone: `label` vira aria-label e dica; área de 28 px. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { label: string; children: ReactNode }>(
  function IconButton({ label, className, type = 'button', children, ...rest }, ref) {
    return <button ref={ref} type={type} className={`np-icon-btn${className ? ` ${className}` : ''}`} aria-label={label} title={label} {...rest}>{children}</button>
  })
