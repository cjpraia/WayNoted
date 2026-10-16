// Área de texto compartilhada (estilos em controls.css). Use no lugar de <textarea> avulsa.
import { forwardRef, type TextareaHTMLAttributes } from 'react'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={`np-textarea${className ? ` ${className}` : ''}`} {...rest} />
  })
